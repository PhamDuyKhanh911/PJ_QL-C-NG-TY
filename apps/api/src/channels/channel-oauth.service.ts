import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { ChannelConnectionStatus, ChannelType } from '@prisma/client';
import { createHash, createHmac, randomBytes } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';
import { ChannelCredentialCipherService } from './channel-credential-cipher.service';

type OAuthTokenResult = {
  accessToken: string;
  refreshToken?: string;
  accessTokenExpiresAt: Date;
  refreshTokenExpiresAt?: Date;
  grantedScopes: string[];
  accountIdentifier: string;
  externalShopId?: string;
};

type FacebookPageGrant = { id: string; name: string; accessToken: string; tasks: string[] };
type FacebookPendingGrant = { pages: FacebookPageGrant[]; accessTokenExpiresAt: string; grantedScopes: string[] };

@Injectable()
export class ChannelOAuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly credentials: ChannelCredentialCipherService,
  ) {}

  async start(organizationId: string, userId: string, channelAccountId: string) {
    const channel = await this.prisma.salesChannelAccount.findFirst({
      where: { id: channelAccountId, organizationId, active: true },
      include: { connection: true },
    });
    if (!channel) throw new NotFoundException('Không tìm thấy seller đang hoạt động');
    const oauthProviders: ChannelType[] = [ChannelType.SHOPEE, ChannelType.TIKTOK_SHOP, ChannelType.FACEBOOK_MESSENGER];
    if (!oauthProviders.includes(channel.type)) throw new BadRequestException('Kênh này chưa hỗ trợ đăng nhập OAuth');
    if (!channel.connection?.clientId || !channel.connection.clientSecretEncrypted) throw new BadRequestException('Cần lưu App/Partner ID và khóa bí mật trước khi kết nối OAuth');
    if (channel.type === ChannelType.TIKTOK_SHOP && !channel.connection.authorizationIdentifier) throw new BadRequestException('TikTok Shop cần Service ID hoặc Authorization URL từ Partner Center');

    const state = randomBytes(32).toString('base64url');
    const stateHash = this.hash(state);
    const callbackBase = `${this.apiPublicUrl()}/api/channels/oauth/callback/${channel.id}`;
    const providerCallbackUrl = channel.type === ChannelType.SHOPEE ? `${callbackBase}?state=${encodeURIComponent(state)}` : callbackBase;
    const expiresAt = new Date(Date.now() + 10 * 60_000);
    const clientSecret = this.credentials.decrypt(channel.connection.clientSecretEncrypted);
    const authorizationUrl = channel.type === ChannelType.SHOPEE
      ? this.shopeeAuthorizationUrl(channel.connection, clientSecret, providerCallbackUrl)
      : channel.type === ChannelType.TIKTOK_SHOP
        ? this.tiktokAuthorizationUrl(channel.connection.authorizationIdentifier!, state)
        : this.facebookAuthorizationUrl(channel.connection.clientId, callbackBase, state);
    await this.prisma.channelOAuthSession.updateMany({
      where: { channelAccountId: channel.id, status: 'PENDING' },
      data: { status: 'SUPERSEDED', consumedAt: new Date() },
    });
    await this.prisma.channelOAuthSession.create({
      data: { channelAccountId: channel.id, stateHash, provider: channel.type, callbackUrl: callbackBase, expiresAt, createdById: userId },
    });
    return { authorizationUrl, callbackUrl: callbackBase, expiresAt, provider: channel.type };
  }

  async complete(channelAccountId: string, input: { state?: string; code?: string; authCode?: string; shopId?: string; error?: string; errorDescription?: string }) {
    const webUrl = new URL('/channels', this.webOrigin());
    const state = input.state?.trim();
    if (!state) return this.failure(webUrl, channelAccountId, 'Thiếu state OAuth');
    const session = await this.prisma.channelOAuthSession.findUnique({
      where: { stateHash: this.hash(state) },
      include: { channelAccount: { include: { connection: true } } },
    });
    if (!session || session.channelAccountId !== channelAccountId) return this.failure(webUrl, channelAccountId, 'Phiên OAuth không hợp lệ');
    if (session.status !== 'PENDING') return this.failure(webUrl, channelAccountId, 'Phiên OAuth đã được sử dụng');
    if (session.expiresAt <= new Date()) {
      await this.prisma.channelOAuthSession.update({ where: { id: session.id }, data: { status: 'EXPIRED', consumedAt: new Date() } });
      return this.failure(webUrl, channelAccountId, 'Phiên OAuth đã hết hạn');
    }
    const claimed = await this.prisma.channelOAuthSession.updateMany({
      where: { id: session.id, status: 'PENDING' }, data: { status: 'PROCESSING', consumedAt: new Date() },
    });
    if (!claimed.count) return this.failure(webUrl, channelAccountId, 'Phiên OAuth đang được xử lý hoặc đã sử dụng');
    try {
      if (input.error) throw new Error(input.errorDescription || input.error);
      const code = (input.code || input.authCode || '').trim();
      if (!code) throw new Error('Nền tảng không trả authorization code');
      const connection = session.channelAccount.connection;
      if (!connection?.clientId || !connection.clientSecretEncrypted) throw new Error('Cấu hình ứng dụng không còn hợp lệ');
      const secret = this.credentials.decrypt(connection.clientSecretEncrypted);
      if (session.provider === ChannelType.FACEBOOK_MESSENGER) {
        const grant = await this.exchangeFacebook(connection.clientId, secret, code, session.callbackUrl);
        const preferred = grant.pages.find((page) => page.id === connection.accountIdentifier);
        const selected = preferred ?? (grant.pages.length === 1 ? grant.pages[0] : null);
        if (!selected) {
          const pending: FacebookPendingGrant = { pages: grant.pages, accessTokenExpiresAt: grant.accessTokenExpiresAt.toISOString(), grantedScopes: grant.grantedScopes };
          await this.prisma.channelOAuthSession.update({ where: { id: session.id }, data: { status: 'AWAITING_SELECTION', providerDataEncrypted: this.credentials.encrypt(JSON.stringify(pending)), errorMessage: null } });
          webUrl.searchParams.set('oauth', 'select_page');
          webUrl.searchParams.set('channelId', channelAccountId);
          webUrl.searchParams.set('sessionId', session.id);
          return { success: true, selectionRequired: true, redirectUrl: webUrl.toString() };
        }
        await this.subscribeFacebookPage(selected);
        await this.persistToken(session, this.facebookToken(selected, grant.accessTokenExpiresAt, grant.grantedScopes));
      } else {
        const token = session.provider === ChannelType.SHOPEE
          ? await this.exchangeShopee(connection, secret, code, input.shopId)
          : await this.exchangeTikTok(connection, secret, code);
        await this.persistToken(session, token);
      }
      webUrl.searchParams.set('oauth', 'success');
      webUrl.searchParams.set('channelId', channelAccountId);
      return { success: true, redirectUrl: webUrl.toString() };
    } catch (error) {
      const message = (error instanceof Error ? error.message : 'Không thể hoàn tất OAuth').slice(0, 500);
      await this.prisma.channelOAuthSession.update({ where: { id: session.id }, data: { status: 'FAILED', errorMessage: message } });
      return this.failure(webUrl, channelAccountId, message);
    }
  }

  async facebookPages(organizationId: string, userId: string, channelAccountId: string, sessionId: string) {
    const { session, grant } = await this.facebookPendingGrant(organizationId, userId, channelAccountId, sessionId);
    return { sessionId: session.id, pages: grant.pages.map((page) => ({ id: page.id, name: page.name, tasks: page.tasks })) };
  }

  async selectFacebookPage(organizationId: string, userId: string, channelAccountId: string, sessionId: string, pageId: string) {
    const { session, grant } = await this.facebookPendingGrant(organizationId, userId, channelAccountId, sessionId);
    const page = grant.pages.find((item) => item.id === pageId);
    if (!page) throw new BadRequestException('Page Facebook không thuộc phiên cấp quyền này');
    const claimed = await this.prisma.channelOAuthSession.updateMany({ where: { id: session.id, status: 'AWAITING_SELECTION' }, data: { status: 'PROCESSING_SELECTION' } });
    if (!claimed.count) throw new BadRequestException('Page Facebook đang được xử lý hoặc phiên đã hoàn tất');
    try {
      await this.subscribeFacebookPage(page);
      await this.persistToken(session, this.facebookToken(page, new Date(grant.accessTokenExpiresAt), grant.grantedScopes));
      return { success: true, page: { id: page.id, name: page.name } };
    } catch (error) {
      const message = (error instanceof Error ? error.message : 'Không thể liên kết Page Facebook').slice(0, 500);
      await this.prisma.channelOAuthSession.update({ where: { id: session.id }, data: { status: 'FAILED', errorMessage: message } });
      throw new BadRequestException(message);
    }
  }

  private shopeeAuthorizationUrl(connection: { clientId: string | null; apiBaseUrl: string | null; environment: string }, secret: string, callbackUrl: string) {
    const partnerId = Number(connection.clientId);
    if (!Number.isSafeInteger(partnerId)) throw new BadRequestException('Shopee Partner ID phải là số nguyên hợp lệ');
    const path = '/api/v2/shop/auth_partner';
    const timestamp = Math.floor(Date.now() / 1_000);
    const sign = createHmac('sha256', secret).update(`${partnerId}${path}${timestamp}`).digest('hex');
    const url = new URL(`${this.shopeeHost(connection)}${path}`);
    url.searchParams.set('partner_id', String(partnerId));
    url.searchParams.set('timestamp', String(timestamp));
    url.searchParams.set('sign', sign);
    url.searchParams.set('redirect', callbackUrl);
    return url.toString();
  }

  private tiktokAuthorizationUrl(identifier: string, state: string) {
    let url: URL;
    if (/^https:\/\//i.test(identifier)) {
      url = new URL(identifier);
      const allowed = ['services.tiktokshop.com', 'services.us.tiktokshop.com', 'services.tiktokshops.us'];
      if (!allowed.includes(url.hostname)) throw new BadRequestException('Authorization URL TikTok Shop không thuộc tên miền được phép');
    } else {
      url = new URL('https://services.tiktokshop.com/open/authorize');
      url.searchParams.set('service_id', identifier);
    }
    if (!url.searchParams.get('service_id')) throw new BadRequestException('Authorization URL TikTok Shop thiếu service_id');
    url.searchParams.set('state', state);
    return url.toString();
  }

  private facebookAuthorizationUrl(clientId: string, callbackUrl: string, state: string) {
    const version = process.env.META_GRAPH_VERSION ?? 'v27.0';
    const url = new URL(`https://www.facebook.com/${version}/dialog/oauth`);
    url.searchParams.set('client_id', clientId);
    url.searchParams.set('redirect_uri', callbackUrl);
    url.searchParams.set('state', state);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('display', 'popup');
    url.searchParams.set('scope', 'pages_show_list,pages_manage_metadata,pages_read_engagement,pages_messaging');
    return url.toString();
  }

  private async exchangeShopee(connection: { clientId: string | null; apiBaseUrl: string | null; environment: string }, secret: string, code: string, shopIdValue?: string): Promise<OAuthTokenResult> {
    const partnerId = Number(connection.clientId);
    const shopId = Number(shopIdValue);
    if (!Number.isSafeInteger(partnerId) || !Number.isSafeInteger(shopId)) throw new Error('Shopee callback thiếu Shop ID hợp lệ');
    const path = '/api/v2/auth/token/get';
    const timestamp = Math.floor(Date.now() / 1_000);
    const sign = createHmac('sha256', secret).update(`${partnerId}${path}${timestamp}`).digest('hex');
    const url = new URL(`${this.shopeeHost(connection)}${path}`);
    url.searchParams.set('partner_id', String(partnerId));
    url.searchParams.set('timestamp', String(timestamp));
    url.searchParams.set('sign', sign);
    const payload = this.objectValue(await this.fetchJson(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ partner_id: partnerId, shop_id: shopId, code }) }));
    if (this.stringValue(payload.error)) throw new Error(this.errorFrom(payload, 'Shopee từ chối authorization code'));
    const accessToken = this.stringValue(payload.access_token);
    const refreshToken = this.stringValue(payload.refresh_token);
    if (!accessToken || !refreshToken) throw new Error('Shopee không trả access token hoặc refresh token');
    return {
      accessToken, refreshToken, accountIdentifier: String(shopId), externalShopId: String(shopId), grantedScopes: [],
      accessTokenExpiresAt: new Date(Date.now() + Math.max(60, Number(payload.expire_in) || 14_400) * 1_000),
      refreshTokenExpiresAt: new Date(Date.now() + 30 * 86_400_000),
    };
  }

  private async exchangeTikTok(connection: { clientId: string | null; accountIdentifier: string | null; apiBaseUrl: string | null }, secret: string, code: string): Promise<OAuthTokenResult> {
    const appKey = connection.clientId ?? '';
    const authBase = (process.env.TIKTOK_AUTH_BASE_URL ?? 'https://auth.tiktok-shops.com').replace(/\/$/, '');
    const url = new URL(`${authBase}/api/v2/token/get`);
    url.searchParams.set('app_key', appKey);
    url.searchParams.set('app_secret', secret);
    url.searchParams.set('auth_code', code);
    url.searchParams.set('grant_type', 'authorized_code');
    const payload = this.objectValue(await this.fetchJson(url, { method: 'GET' }));
    if (Number(payload.code) !== 0) throw new Error(this.errorFrom(payload, 'TikTok Shop từ chối authorization code'));
    const data = this.objectValue(payload.data);
    if (data.user_type !== undefined && Number(data.user_type) !== 0) throw new Error('Token TikTok không thuộc tài khoản seller');
    const accessToken = this.stringValue(data.access_token);
    const refreshToken = this.stringValue(data.refresh_token);
    if (!accessToken || !refreshToken) throw new Error('TikTok Shop không trả access token hoặc refresh token');
    const shop = await this.tiktokAuthorizedShop(connection.apiBaseUrl, appKey, secret, accessToken, connection.accountIdentifier);
    return {
      accessToken, refreshToken, accountIdentifier: shop.cipher, externalShopId: shop.id, grantedScopes: this.scopes(data.granted_scopes),
      accessTokenExpiresAt: this.expiry(data.access_token_expire_in, 7 * 86_400),
      refreshTokenExpiresAt: this.expiry(data.refresh_token_expire_in, 365 * 86_400),
    };
  }

  private async exchangeFacebook(clientId: string, secret: string, code: string, callbackUrl: string) {
    const version = process.env.META_GRAPH_VERSION ?? 'v27.0';
    const graph = `https://graph.facebook.com/${version}`;
    const shortUrl = new URL(`${graph}/oauth/access_token`);
    shortUrl.searchParams.set('client_id', clientId);
    shortUrl.searchParams.set('client_secret', secret);
    shortUrl.searchParams.set('redirect_uri', callbackUrl);
    shortUrl.searchParams.set('code', code);
    const shortPayload = this.objectValue(await this.fetchJson(shortUrl, { method: 'GET' }));
    const shortToken = this.stringValue(shortPayload.access_token);
    if (!shortToken) throw new Error('Facebook không trả access token');

    const longUrl = new URL(`${graph}/oauth/access_token`);
    longUrl.searchParams.set('grant_type', 'fb_exchange_token');
    longUrl.searchParams.set('client_id', clientId);
    longUrl.searchParams.set('client_secret', secret);
    longUrl.searchParams.set('fb_exchange_token', shortToken);
    const longPayload = this.objectValue(await this.fetchJson(longUrl, { method: 'GET' }));
    const userToken = this.stringValue(longPayload.access_token) || shortToken;
    const accessTokenExpiresAt = new Date(Date.now() + Math.max(3_600, Number(longPayload.expires_in || shortPayload.expires_in) || 5_184_000) * 1_000);

    const permissionUrl = new URL(`${graph}/me/permissions`);
    permissionUrl.searchParams.set('access_token', userToken);
    const permissionPayload = this.objectValue(await this.fetchJson(permissionUrl, { method: 'GET' }));
    const permissions = Array.isArray(permissionPayload.data) ? permissionPayload.data.map((item) => this.objectValue(item)).filter((item) => item.status === 'granted').map((item) => this.stringValue(item.permission)).filter(Boolean) : [];
    const required = ['pages_show_list', 'pages_manage_metadata', 'pages_read_engagement', 'pages_messaging'];
    const missing = required.filter((scope) => !permissions.includes(scope));
    if (missing.length) throw new Error(`Facebook chưa cấp đủ quyền: ${missing.join(', ')}`);

    const pagesUrl = new URL(`${graph}/me/accounts`);
    pagesUrl.searchParams.set('fields', 'id,name,access_token,tasks');
    pagesUrl.searchParams.set('limit', '100');
    pagesUrl.searchParams.set('access_token', userToken);
    const pagePayload = this.objectValue(await this.fetchJson(pagesUrl, { method: 'GET' }));
    const pages: FacebookPageGrant[] = Array.isArray(pagePayload.data) ? pagePayload.data.map((item) => this.objectValue(item)).map((item) => ({ id: this.stringValue(item.id), name: this.stringValue(item.name), accessToken: this.stringValue(item.access_token), tasks: Array.isArray(item.tasks) ? item.tasks.filter((task): task is string => typeof task === 'string') : [] })).filter((page) => page.id && page.accessToken) : [];
    if (!pages.length) throw new Error('Tài khoản Facebook không trả Page nào có quyền quản lý tin nhắn');
    return { pages, accessTokenExpiresAt, grantedScopes: permissions };
  }

  private async subscribeFacebookPage(page: FacebookPageGrant) {
    const version = process.env.META_GRAPH_VERSION ?? 'v27.0';
    const url = new URL(`https://graph.facebook.com/${version}/${encodeURIComponent(page.id)}/subscribed_apps`);
    url.searchParams.set('subscribed_fields', 'messages,messaging_postbacks,message_deliveries,message_reads');
    url.searchParams.set('access_token', page.accessToken);
    const payload = this.objectValue(await this.fetchJson(url, { method: 'POST' }));
    if (payload.success !== true) throw new Error(`Không thể đăng ký webhook cho Page ${page.name}`);
  }

  private facebookToken(page: FacebookPageGrant, accessTokenExpiresAt: Date, grantedScopes: string[]): OAuthTokenResult {
    return { accessToken: page.accessToken, accessTokenExpiresAt, grantedScopes, accountIdentifier: page.id, externalShopId: page.id };
  }

  private async facebookPendingGrant(organizationId: string, userId: string, channelAccountId: string, sessionId: string) {
    const session = await this.prisma.channelOAuthSession.findFirst({ where: { id: sessionId, channelAccountId, createdById: userId, provider: ChannelType.FACEBOOK_MESSENGER, status: 'AWAITING_SELECTION', channelAccount: { organizationId } }, include: { channelAccount: { include: { connection: true } } } });
    if (!session?.providerDataEncrypted) throw new NotFoundException('Không tìm thấy phiên chọn Page Facebook');
    if (session.expiresAt <= new Date()) throw new BadRequestException('Phiên chọn Page Facebook đã hết hạn');
    let grant: FacebookPendingGrant;
    try { grant = JSON.parse(this.credentials.decrypt(session.providerDataEncrypted)) as FacebookPendingGrant; }
    catch { throw new BadRequestException('Dữ liệu cấp quyền Facebook không hợp lệ'); }
    if (!Array.isArray(grant.pages) || !grant.pages.length) throw new BadRequestException('Facebook không trả Page có thể liên kết');
    return { session, grant };
  }

  private async persistToken(session: { id: string; provider: ChannelType; channelAccountId: string; createdById: string; channelAccount: { organizationId: string; name: string; connection: { id: string; webhookSecretEncrypted: string | null } | null } }, token: OAuthTokenResult) {
    const connection = session.channelAccount.connection;
    if (!connection) throw new Error('Cấu hình kết nối không còn tồn tại');
    const facebookNeedsWebhookSecret = session.provider === ChannelType.FACEBOOK_MESSENGER && !connection.webhookSecretEncrypted;
    await this.prisma.$transaction([
      this.prisma.channelConnection.update({ where: { id: connection.id }, data: {
        accountIdentifier: token.accountIdentifier,
        accessTokenEncrypted: this.credentials.encrypt(token.accessToken),
        refreshTokenEncrypted: token.refreshToken ? this.credentials.encrypt(token.refreshToken) : null,
        accessTokenExpiresAt: token.accessTokenExpiresAt,
        refreshTokenExpiresAt: token.refreshTokenExpiresAt ?? null,
        grantedScopes: token.grantedScopes,
        lastTokenRefreshAt: new Date(), tokenRefreshStatus: 'SUCCEEDED', tokenRefreshLeaseUntil: null,
        status: facebookNeedsWebhookSecret ? ChannelConnectionStatus.INCOMPLETE : ChannelConnectionStatus.READY,
        lastCheckedAt: new Date(), lastError: facebookNeedsWebhookSecret ? 'Thiếu Webhook Secret để xác minh callback Facebook' : null,
      } }),
      this.prisma.salesChannelAccount.update({ where: { id: session.channelAccountId }, data: { externalShopId: token.externalShopId ?? token.accountIdentifier } }),
      this.prisma.channelOAuthSession.update({ where: { id: session.id }, data: { status: 'COMPLETED', providerDataEncrypted: null, errorMessage: null } }),
      this.prisma.auditEvent.create({ data: { organizationId: session.channelAccount.organizationId, actorId: session.createdById, category: 'CHANNEL', action: 'CHANNEL_OAUTH_CONNECTED', entityType: 'SALES_CHANNEL_ACCOUNT', entityId: session.channelAccountId, summary: `Cấp quyền ${session.channelAccount.name} thành công`, metadata: { provider: session.provider, accountIdentifier: token.accountIdentifier, grantedScopes: token.grantedScopes } } }),
    ]);
  }

  private async tiktokAuthorizedShop(configuredBase: string | null, appKey: string, secret: string, accessToken: string, preferred: string | null) {
    const path = '/authorization/202309/shops';
    const timestamp = String(Math.floor(Date.now() / 1_000));
    const parameters: Record<string, string> = { app_key: appKey, timestamp };
    let input = path;
    for (const key of Object.keys(parameters).sort()) input += `${key}${parameters[key]}`;
    input = `${secret}${input}${secret}`;
    const sign = createHmac('sha256', secret).update(input).digest('hex');
    const base = (process.env.TIKTOK_API_BASE_URL || configuredBase || 'https://open-api.tiktokglobalshop.com').replace(/\/$/, '');
    const url = new URL(`${base}${path}`);
    Object.entries(parameters).forEach(([key, value]) => url.searchParams.set(key, value));
    url.searchParams.set('sign', sign);
    const payload = this.objectValue(await this.fetchJson(url, { method: 'GET', headers: { 'content-type': 'application/json', 'x-tts-access-token': accessToken } }));
    if (Number(payload.code) !== 0) throw new Error(this.errorFrom(payload, 'Không lấy được danh sách shop TikTok đã cấp quyền'));
    const data = this.objectValue(payload.data);
    const shops = Array.isArray(data.shops) ? data.shops.map((item) => this.objectValue(item)) : [];
    const selected = shops.find((item) => [this.stringValue(item.cipher), this.stringValue(item.id)].includes(preferred ?? '')) ?? shops[0];
    const cipher = this.stringValue(selected?.cipher);
    if (!cipher) throw new Error('TikTok Shop không trả shop cipher đã cấp quyền');
    return { cipher, id: this.stringValue(selected.id) || cipher };
  }

  private shopeeHost(connection: { apiBaseUrl: string | null; environment: string }) {
    return (connection.apiBaseUrl?.trim() || (connection.environment === 'SANDBOX' ? 'https://partner.test-stable.shopeemobile.com' : 'https://partner.shopeemobile.com')).replace(/\/$/, '');
  }

  private async fetchJson(url: URL, init: RequestInit) {
    let response: Response;
    try { response = await fetch(url, { ...init, signal: AbortSignal.timeout(15_000) }); }
    catch (error) { throw new Error(error instanceof Error ? `Không kết nối được nền tảng: ${error.message}` : 'Không kết nối được nền tảng'); }
    const raw = await response.text();
    let payload: unknown;
    try { payload = raw ? JSON.parse(raw) : {}; } catch { throw new Error(`Nền tảng trả dữ liệu không hợp lệ (HTTP ${response.status})`); }
    if (!response.ok) throw new Error(this.errorFrom(this.objectValue(payload), `Nền tảng trả HTTP ${response.status}`));
    return payload;
  }

  private failure(url: URL, channelId: string, message: string) {
    url.searchParams.set('oauth', 'error');
    url.searchParams.set('channelId', channelId);
    url.searchParams.set('message', message);
    return { success: false, redirectUrl: url.toString() };
  }

  private apiPublicUrl() { return (process.env.API_PUBLIC_URL ?? `http://localhost:${process.env.API_PORT ?? 4000}`).replace(/\/$/, ''); }
  private webOrigin() { return process.env.WEB_ORIGIN ?? 'http://localhost:3000'; }
  private hash(value: string) { return createHash('sha256').update(value).digest('hex'); }
  private objectValue(value: unknown): Record<string, unknown> { return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : {}; }
  private stringValue(value: unknown) { return typeof value === 'string' ? value.trim() : ''; }
  private scopes(value: unknown) { return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : typeof value === 'string' ? value.split(',').map((item) => item.trim()).filter(Boolean) : []; }
  private expiry(value: unknown, fallbackSeconds: number) { const parsed = Number(value); return Number.isFinite(parsed) && parsed > 0 ? parsed > 1_000_000_000 ? new Date(parsed * 1_000) : new Date(Date.now() + parsed * 1_000) : new Date(Date.now() + fallbackSeconds * 1_000); }
  private errorFrom(payload: Record<string, unknown>, fallback: string) { return this.stringValue(payload.message) || this.stringValue(payload.error_description) || this.stringValue(payload.error) || fallback; }
}
