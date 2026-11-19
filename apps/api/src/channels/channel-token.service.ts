import { BadRequestException, Injectable, NotFoundException, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ChannelConnectionStatus, ChannelType } from '@prisma/client';
import { createHmac } from 'node:crypto';
import { ChannelCredentialCipherService } from './channel-credential-cipher.service';
import { PrismaService } from '../prisma/prisma.service';

type TokenResult = {
  accessToken: string;
  refreshToken: string;
  accessTokenExpiresAt: Date;
  refreshTokenExpiresAt?: Date;
  grantedScopes?: string[];
};

@Injectable()
export class ChannelTokenService implements OnModuleInit, OnModuleDestroy {
  private worker?: NodeJS.Timeout;
  private busy = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly credentials: ChannelCredentialCipherService,
  ) {}

  onModuleInit() {
    this.worker = setInterval(() => void this.runWorker(), 60_000);
    this.worker.unref();
  }

  onModuleDestroy() {
    if (this.worker) clearInterval(this.worker);
  }

  async refreshExpiring(organizationId?: string, limit = 20) {
    const now = new Date();
    const refreshBefore = new Date(now.getTime() + 15 * 60_000);
    const connections = await this.prisma.channelConnection.findMany({
      where: {
        channelAccount: {
          active: true,
          type: { in: [ChannelType.SHOPEE, ChannelType.TIKTOK_SHOP] },
          ...(organizationId ? { organizationId } : {}),
        },
        refreshTokenEncrypted: { not: null },
        tokenRefreshStatus: { not: 'REAUTH_REQUIRED' },
        accessTokenExpiresAt: { lte: refreshBefore },
        OR: [{ tokenRefreshLeaseUntil: null }, { tokenRefreshLeaseUntil: { lt: now } }],
      },
      orderBy: { accessTokenExpiresAt: 'asc' },
      take: limit,
      select: { channelAccountId: true },
    });
    const results = [];
    for (const connection of connections) results.push(await this.refreshChannel(undefined, connection.channelAccountId));
    return {
      selected: connections.length,
      refreshed: results.filter((result) => result.tokenRefreshStatus === 'SUCCEEDED').length,
      failed: results.filter((result) => result.tokenRefreshStatus === 'FAILED' || result.tokenRefreshStatus === 'REAUTH_REQUIRED').length,
    };
  }

  async refreshNow(organizationId: string, channelAccountId: string) {
    return this.refreshChannel(organizationId, channelAccountId, true);
  }

  private async refreshChannel(organizationId: string | undefined, channelAccountId: string, force = false) {
    const now = new Date();
    const claimed = await this.prisma.channelConnection.updateMany({
      where: {
        channelAccountId,
        ...(organizationId ? { channelAccount: { organizationId } } : {}),
        OR: [{ tokenRefreshStatus: { not: 'REFRESHING' } }, { tokenRefreshLeaseUntil: { lt: now } }],
      },
      data: { tokenRefreshStatus: 'REFRESHING', tokenRefreshLeaseUntil: new Date(now.getTime() + 2 * 60_000) },
    });
    if (!claimed.count) {
      const connection = await this.prisma.channelConnection.findUnique({ where: { channelAccountId } });
      if (!connection) throw new NotFoundException('Không tìm thấy cấu hình seller');
      return connection;
    }
    const connection = await this.prisma.channelConnection.findUniqueOrThrow({
      where: { channelAccountId },
      include: { channelAccount: true },
    });
    if (connection.channelAccount.type !== ChannelType.SHOPEE && connection.channelAccount.type !== ChannelType.TIKTOK_SHOP) {
      await this.prisma.channelConnection.update({ where: { id: connection.id }, data: { tokenRefreshStatus: 'IDLE', tokenRefreshLeaseUntil: null } });
      throw new BadRequestException('Kênh này không dùng cơ chế refresh token marketplace');
    }
    if (!force && connection.accessTokenExpiresAt && connection.accessTokenExpiresAt.getTime() > Date.now() + 15 * 60_000) {
      return this.prisma.channelConnection.update({ where: { id: connection.id }, data: { tokenRefreshStatus: 'IDLE', tokenRefreshLeaseUntil: null } });
    }
    if (!connection.refreshTokenEncrypted || !connection.clientSecretEncrypted || !connection.clientId || !connection.accountIdentifier) {
      return this.fail(connection.id, 'REAUTH_REQUIRED', 'Thiếu Refresh Token, App/Partner ID, khóa bí mật hoặc Shop ID');
    }
    if (connection.refreshTokenExpiresAt && connection.refreshTokenExpiresAt <= now) {
      return this.fail(connection.id, 'REAUTH_REQUIRED', 'Refresh Token đã hết hạn; seller cần cấp quyền lại');
    }

    try {
      const refreshToken = this.credentials.decrypt(connection.refreshTokenEncrypted);
      const clientSecret = this.credentials.decrypt(connection.clientSecretEncrypted);
      const result = connection.channelAccount.type === ChannelType.SHOPEE
        ? await this.refreshShopee(connection, clientSecret, refreshToken)
        : await this.refreshTikTok(connection.clientId, clientSecret, refreshToken);
      return this.prisma.channelConnection.update({
        where: { id: connection.id },
        data: {
          accessTokenEncrypted: this.credentials.encrypt(result.accessToken),
          refreshTokenEncrypted: this.credentials.encrypt(result.refreshToken),
          accessTokenExpiresAt: result.accessTokenExpiresAt,
          ...(result.refreshTokenExpiresAt ? { refreshTokenExpiresAt: result.refreshTokenExpiresAt } : {}),
          ...(result.grantedScopes ? { grantedScopes: result.grantedScopes } : {}),
          lastTokenRefreshAt: new Date(),
          tokenRefreshStatus: 'SUCCEEDED',
          tokenRefreshLeaseUntil: null,
          status: ChannelConnectionStatus.READY,
          lastCheckedAt: new Date(),
          lastError: null,
        },
      });
    } catch (error) {
      return this.fail(connection.id, 'FAILED', error instanceof Error ? error.message : 'Không thể làm mới token');
    }
  }

  private async refreshTikTok(appKey: string, appSecret: string, refreshToken: string): Promise<TokenResult> {
    const url = new URL('https://auth.tiktok-shops.com/api/v2/token/refresh');
    url.searchParams.set('app_key', appKey);
    url.searchParams.set('app_secret', appSecret);
    url.searchParams.set('refresh_token', refreshToken);
    url.searchParams.set('grant_type', 'refresh_token');
    const payload = await this.fetchJson(url, { method: 'GET' }) as Record<string, unknown>;
    if (Number(payload.code) !== 0) throw new Error(this.errorFrom(payload, 'TikTok Shop từ chối làm mới token'));
    const data = this.objectValue(payload.data);
    const accessToken = this.stringValue(data.access_token);
    const nextRefreshToken = this.stringValue(data.refresh_token);
    if (!accessToken || !nextRefreshToken) throw new Error('TikTok Shop không trả access token hoặc refresh token mới');
    return {
      accessToken,
      refreshToken: nextRefreshToken,
      accessTokenExpiresAt: this.expiry(data.access_token_expire_in, 86_400),
      refreshTokenExpiresAt: this.expiry(data.refresh_token_expire_in, 30 * 86_400),
      grantedScopes: this.scopes(data.granted_scopes),
    };
  }

  private async refreshShopee(connection: { clientId: string | null; accountIdentifier: string | null; apiBaseUrl: string | null; environment: string }, partnerKey: string, refreshToken: string): Promise<TokenResult> {
    const partnerId = Number(connection.clientId);
    const shopId = Number(connection.accountIdentifier);
    if (!Number.isSafeInteger(partnerId) || !Number.isSafeInteger(shopId)) throw new Error('Shopee Partner ID và Shop ID phải là số nguyên hợp lệ');
    const path = '/api/v2/auth/access_token/get';
    const timestamp = Math.floor(Date.now() / 1_000);
    const sign = createHmac('sha256', partnerKey).update(`${partnerId}${path}${timestamp}`).digest('hex');
    const host = (connection.apiBaseUrl?.trim() || (connection.environment === 'SANDBOX' ? 'https://partner.test-stable.shopeemobile.com' : 'https://partner.shopeemobile.com')).replace(/\/$/, '');
    const url = new URL(`${host}${path}`);
    url.searchParams.set('partner_id', String(partnerId));
    url.searchParams.set('timestamp', String(timestamp));
    url.searchParams.set('sign', sign);
    const payload = await this.fetchJson(url, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ partner_id: partnerId, shop_id: shopId, refresh_token: refreshToken }),
    }) as Record<string, unknown>;
    if (this.stringValue(payload.error)) throw new Error(this.errorFrom(payload, 'Shopee từ chối làm mới token'));
    const accessToken = this.stringValue(payload.access_token);
    const nextRefreshToken = this.stringValue(payload.refresh_token);
    if (!accessToken || !nextRefreshToken) throw new Error('Shopee không trả access token hoặc refresh token mới');
    return {
      accessToken,
      refreshToken: nextRefreshToken,
      accessTokenExpiresAt: new Date(Date.now() + Math.max(60, Number(payload.expire_in) || 14_400) * 1_000),
      refreshTokenExpiresAt: new Date(Date.now() + 30 * 86_400_000),
    };
  }

  private async fetchJson(url: URL, init: RequestInit) {
    let response: Response;
    try { response = await fetch(url, { ...init, signal: AbortSignal.timeout(15_000) }); }
    catch (error) { throw new Error(error instanceof Error ? `Không kết nối được máy chủ token: ${error.message}` : 'Không kết nối được máy chủ token'); }
    const raw = await response.text();
    let payload: unknown;
    try { payload = raw ? JSON.parse(raw) : {}; } catch { throw new Error(`Máy chủ token trả dữ liệu không hợp lệ (HTTP ${response.status})`); }
    if (!response.ok) throw new Error(this.errorFrom(this.objectValue(payload), `Máy chủ token trả HTTP ${response.status}`));
    return payload;
  }

  private fail(id: string, status: 'FAILED' | 'REAUTH_REQUIRED', message: string) {
    return this.prisma.channelConnection.update({
      where: { id },
      data: {
        tokenRefreshStatus: status,
        tokenRefreshLeaseUntil: status === 'FAILED' ? new Date(Date.now() + 5 * 60_000) : null,
        status: ChannelConnectionStatus.ERROR,
        lastCheckedAt: new Date(),
        lastError: message.slice(0, 1_000),
      },
    });
  }

  private expiry(value: unknown, fallbackSeconds: number) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed <= 0) return new Date(Date.now() + fallbackSeconds * 1_000);
    return parsed > 1_000_000_000 ? new Date(parsed * 1_000) : new Date(Date.now() + parsed * 1_000);
  }

  private scopes(value: unknown) {
    if (Array.isArray(value)) return value.filter((item): item is string => typeof item === 'string');
    if (typeof value === 'string') return value.split(',').map((item) => item.trim()).filter(Boolean);
    return undefined;
  }

  private objectValue(value: unknown): Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : {};
  }

  private stringValue(value: unknown) { return typeof value === 'string' ? value.trim() : ''; }

  private errorFrom(payload: Record<string, unknown>, fallback: string) {
    return this.stringValue(payload.message) || this.stringValue(payload.error_description) || this.stringValue(payload.error) || fallback;
  }

  private async runWorker() {
    if (this.busy) return;
    this.busy = true;
    try { await this.refreshExpiring(undefined, 20); } catch { /* Kết nối vẫn lưu trạng thái để lượt sau tiếp tục. */ }
    finally { this.busy = false; }
  }
}
