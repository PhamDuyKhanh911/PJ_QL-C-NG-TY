import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { ChannelConnection, ChannelConnectionStatus, ChannelSyncStatus, ChannelType } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ChannelCredentialCipherService } from './channel-credential-cipher.service';
import { ChannelTokenService } from './channel-token.service';
import { ChannelOAuthService } from './channel-oauth.service';
import { UpdateChannelConnectionDto } from './dto/update-channel-connection.dto';
import { ChannelInventoryPushService } from './channel-inventory-push.service';

@Injectable()
export class ChannelsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly credentialCipher: ChannelCredentialCipherService,
    private readonly tokens: ChannelTokenService,
    private readonly oauth: ChannelOAuthService,
    private readonly inventoryPush: ChannelInventoryPushService,
  ) {}

  async list(organizationId: string) {
    const [channels, warehouses] = await Promise.all([this.prisma.salesChannelAccount.findMany({
      where: { organizationId },
      include: {
        connection: true,
        skuMappings: { include: { variant: { include: { balances: true, product: { select: { active: true } } } } } },
        syncRuns: { orderBy: { startedAt: 'desc' }, take: 5 },
        _count: { select: { orders: true, conversations: true } },
      },
      orderBy: [{ type: 'asc' }, { name: 'asc' }],
    }), this.prisma.warehouse.findMany({ where: { branch: { organizationId } }, select: { id: true, code: true, name: true, branch: { select: { name: true } } }, orderBy: { name: 'asc' } })]);
    return channels.map((channel) => ({
      id: channel.id,
      code: channel.code,
      name: channel.name,
      type: channel.type,
      active: channel.active,
      externalShopId: channel.externalShopId,
      mappedSkuCount: channel.skuMappings.length,
      availableUnits: channel.skuMappings.reduce((total, mapping) => total + (mapping.variant.product.active ? mapping.variant.balances.reduce((sum, balance) => sum + Math.max(0, balance.onHand - balance.reserved - balance.quarantined - balance.safetyStock), 0) : 0), 0),
      orderCount: channel._count.orders,
      conversationCount: channel._count.conversations,
      recentSyncs: channel.syncRuns,
      warehouseOptions: warehouses,
      connection: this.connectionView(channel, channel.connection),
    }));
  }

  async getConnection(organizationId: string, channelId: string) {
    const channel = await this.prisma.salesChannelAccount.findFirst({ where: { id: channelId, organizationId }, include: { connection: true } });
    if (!channel) throw new NotFoundException('Không tìm thấy kênh bán');
    return this.connectionView(channel, channel.connection);
  }

  async saveConnection(organizationId: string, userId: string, channelId: string, input: UpdateChannelConnectionDto) {
    const channel = await this.prisma.salesChannelAccount.findFirst({ where: { id: channelId, organizationId, active: true }, include: { connection: true } });
    if (!channel) throw new NotFoundException('Không tìm thấy kênh bán đang hoạt động');
    if (channel.type === ChannelType.OFFLINE_STORE) throw new BadRequestException('Kênh POS nội bộ không cần cấu hình API');
    const officialMarketplace = channel.type === ChannelType.TIKTOK_SHOP || channel.type === ChannelType.SHOPEE;
    const facebook = channel.type === ChannelType.FACEBOOK_MESSENGER;
    if (input.defaultWarehouseId) {
      const warehouse = await this.prisma.warehouse.findFirst({ where: { id: input.defaultWarehouseId, branch: { organizationId } } });
      if (!warehouse) throw new BadRequestException('Kho nhận đơn mặc định không thuộc doanh nghiệp');
    }
    const saved = await this.prisma.channelConnection.upsert({
      where: { channelAccountId: channel.id },
      create: {
        channelAccountId: channel.id,
        environment: input.environment ?? 'PRODUCTION',
        clientId: input.clientId?.trim() || null,
        authorizationIdentifier: input.authorizationIdentifier?.trim() || null,
        accountIdentifier: input.accountIdentifier?.trim() || null,
        apiBaseUrl: input.apiBaseUrl?.trim() || null,
        clientSecretEncrypted: input.clientSecret ? this.credentialCipher.encrypt(input.clientSecret) : null,
        accessTokenEncrypted: input.accessToken ? this.credentialCipher.encrypt(input.accessToken) : null,
        refreshTokenEncrypted: input.refreshToken ? this.credentialCipher.encrypt(input.refreshToken) : null,
        accessTokenExpiresAt: input.accessTokenExpiresAt ? new Date(input.accessTokenExpiresAt) : null,
        refreshTokenExpiresAt: input.refreshTokenExpiresAt ? new Date(input.refreshTokenExpiresAt) : null,
        grantedScopes: input.grantedScopes?.map((scope) => scope.trim()).filter(Boolean) ?? [],
        webhookSecretEncrypted: input.webhookSecret ? this.credentialCipher.encrypt(input.webhookSecret) : null,
        orderSyncEnabled: input.orderSyncEnabled ?? officialMarketplace,
        inventorySyncEnabled: input.inventorySyncEnabled ?? officialMarketplace,
        chatSyncEnabled: input.chatSyncEnabled ?? facebook,
        defaultWarehouseId: input.defaultWarehouseId?.trim() || null,
        updatedById: userId,
      },
      update: {
        ...(input.environment !== undefined ? { environment: input.environment } : {}),
        ...(input.clientId !== undefined ? { clientId: input.clientId.trim() || null } : {}),
        ...(input.authorizationIdentifier !== undefined ? { authorizationIdentifier: input.authorizationIdentifier.trim() || null } : {}),
        ...(input.accountIdentifier !== undefined ? { accountIdentifier: input.accountIdentifier.trim() || null } : {}),
        ...(input.apiBaseUrl !== undefined ? { apiBaseUrl: input.apiBaseUrl.trim() || null } : {}),
        ...(input.clientSecret ? { clientSecretEncrypted: this.credentialCipher.encrypt(input.clientSecret) } : {}),
        ...(input.accessToken ? { accessTokenEncrypted: this.credentialCipher.encrypt(input.accessToken) } : {}),
        ...(input.refreshToken ? { refreshTokenEncrypted: this.credentialCipher.encrypt(input.refreshToken) } : {}),
        ...(input.accessTokenExpiresAt !== undefined ? { accessTokenExpiresAt: new Date(input.accessTokenExpiresAt) } : {}),
        ...(input.refreshTokenExpiresAt !== undefined ? { refreshTokenExpiresAt: new Date(input.refreshTokenExpiresAt) } : {}),
        ...(input.grantedScopes !== undefined ? { grantedScopes: input.grantedScopes.map((scope) => scope.trim()).filter(Boolean) } : {}),
        ...(input.accessToken || input.refreshToken ? { tokenRefreshStatus: 'IDLE', tokenRefreshLeaseUntil: null } : {}),
        ...(input.webhookSecret ? { webhookSecretEncrypted: this.credentialCipher.encrypt(input.webhookSecret) } : {}),
        ...(input.orderSyncEnabled !== undefined ? { orderSyncEnabled: input.orderSyncEnabled } : {}),
        ...(input.inventorySyncEnabled !== undefined ? { inventorySyncEnabled: input.inventorySyncEnabled } : {}),
        ...(input.chatSyncEnabled !== undefined ? { chatSyncEnabled: input.chatSyncEnabled } : {}),
        ...(input.defaultWarehouseId !== undefined ? { defaultWarehouseId: input.defaultWarehouseId.trim() || null } : {}),
        updatedById: userId,
      },
    });
    const missingFields = this.missingFields(channel.type, saved);
    const tokenState = this.tokenState(channel.type, saved);
    const invalidToken = officialMarketplace && ['EXPIRED', 'REAUTH_REQUIRED'].includes(tokenState);
    const checked = await this.prisma.channelConnection.update({
      where: { id: saved.id },
      data: {
        status: missingFields.length ? ChannelConnectionStatus.INCOMPLETE : invalidToken ? ChannelConnectionStatus.ERROR : ChannelConnectionStatus.READY,
        lastCheckedAt: new Date(),
        lastError: missingFields.length ? `Thiếu: ${missingFields.join(', ')}` : invalidToken ? 'Token seller đã hết hạn hoặc cần cấp quyền lại' : null,
      },
    });
    return this.connectionView(channel, checked);
  }

  async checkConnection(organizationId: string, channelId: string) {
    const channel = await this.prisma.salesChannelAccount.findFirst({ where: { id: channelId, organizationId }, include: { connection: true } });
    if (!channel) throw new NotFoundException('Không tìm thấy kênh bán');
    if (channel.type === ChannelType.OFFLINE_STORE) throw new BadRequestException('Kênh POS nội bộ không cần cấu hình API');
    if (!channel.connection) return this.connectionView(channel, null);
    const missingFields = this.missingFields(channel.type, channel.connection);
    const tokenState = this.tokenState(channel.type, channel.connection);
    const invalidToken = (channel.type === ChannelType.SHOPEE || channel.type === ChannelType.TIKTOK_SHOP) && ['EXPIRED', 'REAUTH_REQUIRED'].includes(tokenState);
    const checked = await this.prisma.channelConnection.update({
      where: { id: channel.connection.id },
      data: {
        status: missingFields.length ? ChannelConnectionStatus.INCOMPLETE : invalidToken ? ChannelConnectionStatus.ERROR : ChannelConnectionStatus.READY,
        lastCheckedAt: new Date(),
        lastError: missingFields.length ? `Thiếu: ${missingFields.join(', ')}` : invalidToken ? 'Token seller đã hết hạn hoặc cần cấp quyền lại' : null,
      },
    });
    return { ...this.connectionView(channel, checked), externalVerified: false, note: missingFields.length ? 'Cấu hình chưa đủ để khởi tạo connector.' : 'Cấu hình đã đủ; sẽ xác thực với API nền tảng khi bật connector chính thức.' };
  }

  async refreshToken(organizationId: string, channelId: string) {
    await this.tokens.refreshNow(organizationId, channelId);
    return this.getConnection(organizationId, channelId);
  }

  startOAuth(organizationId: string, userId: string, channelId: string) {
    return this.oauth.start(organizationId, userId, channelId);
  }

  async syncInventory(organizationId: string, channelId: string, userId: string) {
    const channel = await this.prisma.salesChannelAccount.findFirst({ where: { id: channelId, organizationId, active: true }, include: { connection: true, skuMappings: { include: { variant: { include: { product: { select: { active: true } }, balances: { include: { warehouse: true } } } } } } } });
    if (!channel) throw new NotFoundException('Không tìm thấy kênh bán đang hoạt động');
    if (channel.type === ChannelType.SHOPEE || channel.type === ChannelType.TIKTOK_SHOP) {
      const tokenState = this.tokenState(channel.type, channel.connection);
      if (channel.connection?.status !== ChannelConnectionStatus.READY || tokenState !== 'VALID') {
        throw new BadRequestException(`Chưa thể đồng bộ ${channel.name}: token seller đang ở trạng thái ${tokenState}`);
      }
    }
    const snapshot = channel.skuMappings.map((mapping) => ({ sku: mapping.variant.sku, externalProductId: mapping.externalProductId, externalSkuId: mapping.externalSkuId, available: mapping.variant.product.active ? mapping.variant.balances.reduce((sum, balance) => sum + Math.max(0, balance.onHand - balance.reserved - balance.quarantined - balance.safetyStock), 0) : 0, warehouses: mapping.variant.balances.map((balance) => ({ warehouse: balance.warehouse.code, onHand: balance.onHand, reserved: balance.reserved, quarantined: balance.quarantined, safetyStock: balance.safetyStock })) }));
    const run = await this.prisma.channelSyncRun.create({ data: { channelAccountId: channel.id, status: ChannelSyncStatus.RUNNING, direction: 'PUSH_INVENTORY', mappedSkuCount: snapshot.length, snapshot, triggeredById: userId } });
    if (channel.type === ChannelType.SHOPEE || channel.type === ChannelType.TIKTOK_SHOP) return this.inventoryPush.processRun(run.id);
    return this.prisma.channelSyncRun.update({ where: { id: run.id }, data: { status: ChannelSyncStatus.SUCCEEDED, processedCount: snapshot.length, completedAt: new Date() } });
  }

  async syncSummary(organizationId: string) {
    const staleBefore = new Date(Date.now() - 15 * 60_000); const today = new Date(); today.setHours(0, 0, 0, 0);
    const [pending, stale, failed, succeededToday] = await Promise.all([
      this.prisma.channelSyncRun.count({ where: { channelAccount: { organizationId }, status: ChannelSyncStatus.RUNNING } }),
      this.prisma.channelSyncRun.count({ where: { channelAccount: { organizationId }, status: ChannelSyncStatus.RUNNING, startedAt: { lt: staleBefore } } }),
      this.prisma.channelSyncRun.count({ where: { channelAccount: { organizationId }, status: ChannelSyncStatus.FAILED } }),
      this.prisma.channelSyncRun.count({ where: { channelAccount: { organizationId }, status: ChannelSyncStatus.SUCCEEDED, completedAt: { gte: today } } }),
    ]);
    return { pending, stale, failed, succeededToday };
  }

  async inventoryReconciliation(organizationId: string, requestedStatus?: string) {
    const allowedStatuses = ['MATCHED', 'MISMATCH', 'UNMAPPED'];
    const status = requestedStatus?.toUpperCase();
    const baseWhere = { channelAccount: { organizationId } };
    const where = status && allowedStatuses.includes(status) ? { ...baseWhere, status } : baseWhere;
    const [rows, matched, mismatch, unmapped] = await Promise.all([
      this.prisma.channelInventoryReconciliation.findMany({
        where,
        include: { channelAccount: { select: { id: true, code: true, name: true, type: true } } },
        orderBy: [{ status: 'desc' }, { updatedAt: 'desc' }],
        take: 500,
      }),
      this.prisma.channelInventoryReconciliation.count({ where: { ...baseWhere, status: 'MATCHED' } }),
      this.prisma.channelInventoryReconciliation.count({ where: { ...baseWhere, status: 'MISMATCH' } }),
      this.prisma.channelInventoryReconciliation.count({ where: { ...baseWhere, status: 'UNMAPPED' } }),
    ]);
    const pairs = rows.map((row) => ({ channelAccountId: row.channelAccountId, externalSkuId: row.externalSkuId }));
    const mappings = pairs.length
      ? await this.prisma.channelSkuMapping.findMany({
          where: { OR: pairs },
          include: { variant: { include: { product: { select: { id: true, name: true } } } } },
        })
      : [];
    const mappingByKey = new Map(mappings.map((mapping) => [`${mapping.channelAccountId}:${mapping.externalSkuId}`, mapping]));
    return {
      rows: rows.map((row) => {
        const mapping = mappingByKey.get(`${row.channelAccountId}:${row.externalSkuId}`);
        return {
          ...row,
          variant: mapping ? { id: mapping.variant.id, sku: mapping.variant.sku, name: mapping.variant.name, product: mapping.variant.product } : null,
        };
      }),
      summary: { total: matched + mismatch + unmapped, matched, mismatch, unmapped },
    };
  }

  async processPending(organizationId: string, userId: string) {
    void userId;
    return this.inventoryPush.processPending(organizationId, 50);
  }

  private missingFields(type: ChannelType, connection: ChannelConnection | null) {
    if (type === ChannelType.OFFLINE_STORE) return [];
    const missing: string[] = [];
    if (!connection?.clientId) missing.push(type === ChannelType.SHOPEE ? 'Partner ID' : 'App/Client ID');
    if (type === ChannelType.TIKTOK_SHOP && !connection?.authorizationIdentifier) missing.push('TikTok Service ID / Authorization URL');
    if (!connection?.accountIdentifier) missing.push(type === ChannelType.SHOPEE ? 'Shop ID' : type === ChannelType.FACEBOOK_MESSENGER ? 'Page ID' : 'Shop/Cửa hàng ID');
    if (!connection?.clientSecretEncrypted) missing.push(type === ChannelType.SHOPEE ? 'Partner Key' : 'Client Secret');
    if (!connection?.accessTokenEncrypted) missing.push(type === ChannelType.FACEBOOK_MESSENGER ? 'Page Access Token' : 'Access Token');
    if ((type === ChannelType.SHOPEE || type === ChannelType.TIKTOK_SHOP) && !connection?.refreshTokenEncrypted) missing.push('Refresh Token');
    if ((type === ChannelType.SHOPEE || type === ChannelType.TIKTOK_SHOP) && !connection?.accessTokenExpiresAt) missing.push('Thời hạn Access Token');
    if ((type === ChannelType.SHOPEE || type === ChannelType.TIKTOK_SHOP) && !connection?.defaultWarehouseId) missing.push('Kho nhận đơn mặc định');
    if (type === ChannelType.FACEBOOK_MESSENGER && !connection?.webhookSecretEncrypted) missing.push('Webhook Secret');
    return missing;
  }

  private connectionView(channel: { id: string; type: ChannelType }, connection: ChannelConnection | null) {
    const applicable = channel.type !== ChannelType.OFFLINE_STORE;
    const missingFields = applicable ? this.missingFields(channel.type, connection) : [];
    const apiPublicUrl = (process.env.API_PUBLIC_URL ?? `http://localhost:${process.env.API_PORT ?? 4000}`).replace(/\/$/, '');
    return {
      applicable,
      status: applicable ? connection?.status ?? ChannelConnectionStatus.INCOMPLETE : 'NOT_REQUIRED',
      ready: applicable ? Boolean(connection) && missingFields.length === 0 && connection?.status === ChannelConnectionStatus.READY : true,
      missingFields,
      environment: connection?.environment ?? 'PRODUCTION',
      clientId: connection?.clientId ?? '',
      authorizationIdentifier: connection?.authorizationIdentifier ?? '',
      accountIdentifier: connection?.accountIdentifier ?? '',
      apiBaseUrl: connection?.apiBaseUrl ?? '',
      hasClientSecret: Boolean(connection?.clientSecretEncrypted),
      hasAccessToken: Boolean(connection?.accessTokenEncrypted),
      hasRefreshToken: Boolean(connection?.refreshTokenEncrypted),
      accessTokenExpiresAt: connection?.accessTokenExpiresAt ?? null,
      refreshTokenExpiresAt: connection?.refreshTokenExpiresAt ?? null,
      lastTokenRefreshAt: connection?.lastTokenRefreshAt ?? null,
      tokenRefreshStatus: connection?.tokenRefreshStatus ?? 'IDLE',
      tokenState: this.tokenState(channel.type, connection),
      grantedScopes: connection?.grantedScopes ?? [],
      hasWebhookSecret: Boolean(connection?.webhookSecretEncrypted),
      orderSyncEnabled: connection?.orderSyncEnabled ?? false,
      inventorySyncEnabled: connection?.inventorySyncEnabled ?? false,
      chatSyncEnabled: connection?.chatSyncEnabled ?? false,
      defaultWarehouseId: connection?.defaultWarehouseId ?? '',
      orderSyncCursorAt: connection?.orderSyncCursorAt ?? null,
      lastOrderSyncAt: connection?.lastOrderSyncAt ?? null,
      orderSyncStatus: connection?.orderSyncStatus ?? 'IDLE',
      orderSyncError: connection?.orderSyncError ?? null,
      lastCheckedAt: connection?.lastCheckedAt ?? null,
      lastError: connection?.lastError ?? null,
      webhookUrl: applicable ? `${apiPublicUrl}/api/channels/webhooks/${channel.id}` : null,
      oauthCallbackUrl: applicable ? `${apiPublicUrl}/api/channels/oauth/callback/${channel.id}` : null,
      updatedAt: connection?.updatedAt ?? null,
    };
  }

  private tokenState(type: ChannelType, connection: ChannelConnection | null) {
    if (type !== ChannelType.SHOPEE && type !== ChannelType.TIKTOK_SHOP) return 'NOT_APPLICABLE';
    if (!connection?.accessTokenEncrypted) return 'MISSING';
    if (connection.refreshTokenExpiresAt && connection.refreshTokenExpiresAt <= new Date()) return 'REAUTH_REQUIRED';
    if (!connection.accessTokenExpiresAt) return 'UNKNOWN';
    const remaining = connection.accessTokenExpiresAt.getTime() - Date.now();
    if (remaining <= 0) return 'EXPIRED';
    if (remaining <= 15 * 60_000) return 'EXPIRING';
    return 'VALID';
  }
}
