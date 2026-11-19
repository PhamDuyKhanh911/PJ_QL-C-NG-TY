import { BadRequestException, Injectable, NotFoundException, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ChannelConnectionStatus, ChannelSyncStatus, ChannelType, Prisma } from '@prisma/client';
import { createHmac } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';
import { SalesService } from '../sales/sales.service';
import { ChannelCredentialCipherService } from './channel-credential-cipher.service';

type JsonObject = Record<string, unknown>;
type PulledLine = { candidates: string[]; quantity: number; unitPrice?: number };
type PulledOrder = { externalOrderId: string; externalStatus: string; orderedAt: Date; updatedAt: Date; customerName?: string; lines: PulledLine[] };

@Injectable()
export class ChannelOrderSyncService implements OnModuleInit, OnModuleDestroy {
  private worker?: NodeJS.Timeout;
  private workerBusy = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly sales: SalesService,
    private readonly cipher: ChannelCredentialCipherService,
  ) {}

  onModuleInit() {
    this.worker = setInterval(() => void this.runWorker(), 60_000);
    this.worker.unref();
  }

  onModuleDestroy() {
    if (this.worker) clearInterval(this.worker);
  }

  async processDue(organizationId?: string, limit = 10) {
    const now = new Date();
    const dueBefore = new Date(now.getTime() - 5 * 60_000);
    const connections = await this.prisma.channelConnection.findMany({
      where: {
        orderSyncEnabled: true,
        status: ChannelConnectionStatus.READY,
        defaultWarehouseId: { not: null },
        accessTokenEncrypted: { not: null },
        accessTokenExpiresAt: { gt: now },
        OR: [{ lastOrderSyncAt: null }, { lastOrderSyncAt: { lte: dueBefore } }],
        AND: [{ OR: [{ orderSyncLeaseUntil: null }, { orderSyncLeaseUntil: { lt: now } }] }],
        channelAccount: {
          active: true,
          type: { in: [ChannelType.SHOPEE, ChannelType.TIKTOK_SHOP] },
          ...(organizationId ? { organizationId } : {}),
        },
      },
      select: { channelAccountId: true, channelAccount: { select: { organizationId: true } } },
      orderBy: [{ lastOrderSyncAt: { sort: 'asc', nulls: 'first' } }, { updatedAt: 'asc' }],
      take: Math.min(Math.max(limit, 1), 50),
    });
    const results: Array<{ channelAccountId: string; ok: boolean; error?: string }> = [];
    for (const connection of connections) {
      try {
        await this.sync(connection.channelAccount.organizationId, connection.channelAccountId, 'SYSTEM_ORDER_SCHEDULER');
        results.push({ channelAccountId: connection.channelAccountId, ok: true });
      } catch (reason) {
        results.push({ channelAccountId: connection.channelAccountId, ok: false, error: this.message(reason) });
      }
    }
    return { selected: connections.length, succeeded: results.filter((item) => item.ok).length, failed: results.filter((item) => !item.ok).length, results };
  }

  async sync(organizationId: string, channelId: string, userId: string) {
    const channel = await this.prisma.salesChannelAccount.findFirst({
      where: { id: channelId, organizationId, active: true },
      include: { connection: true, skuMappings: { select: { externalSkuId: true } } },
    });
    if (!channel) throw new NotFoundException('Không tìm thấy seller đang hoạt động');
    if (channel.type !== ChannelType.SHOPEE && channel.type !== ChannelType.TIKTOK_SHOP) throw new BadRequestException('Chỉ Shopee và TikTok Shop hỗ trợ kéo đơn tự động');
    const connection = channel.connection;
    if (!connection?.orderSyncEnabled) throw new BadRequestException('Seller chưa bật đồng bộ đơn hàng');
    if (connection.status !== ChannelConnectionStatus.READY || !connection.accessTokenEncrypted) throw new BadRequestException('Kết nối seller hoặc access token chưa sẵn sàng');
    if (!connection.defaultWarehouseId) throw new BadRequestException('Phải chọn kho nhận đơn mặc định trước khi đồng bộ');
    const warehouse = await this.prisma.warehouse.findFirst({ where: { id: connection.defaultWarehouseId, branch: { organizationId } } });
    if (!warehouse) throw new BadRequestException('Kho nhận đơn mặc định không còn hợp lệ');

    const now = new Date();
    const leased = await this.prisma.channelConnection.updateMany({
      where: { id: connection.id, OR: [{ orderSyncLeaseUntil: null }, { orderSyncLeaseUntil: { lt: now } }] },
      data: { orderSyncStatus: 'RUNNING', orderSyncLeaseUntil: new Date(now.getTime() + 5 * 60_000), orderSyncError: null },
    });
    if (leased.count !== 1) throw new BadRequestException('Seller đang có một lượt kéo đơn khác chạy');
    const run = await this.prisma.channelSyncRun.create({ data: { channelAccountId: channel.id, direction: 'PULL_ORDERS', status: ChannelSyncStatus.RUNNING, mappedSkuCount: channel.skuMappings.length, triggeredById: userId } });

    try {
      const from = connection.orderSyncCursorAt ?? new Date(now.getTime() - 7 * 86_400_000);
      const orders = channel.type === ChannelType.SHOPEE
        ? await this.pullShopee(connection, from, now)
        : await this.pullTikTok(connection, from, now);
      const mapped = new Set(channel.skuMappings.map((item) => item.externalSkuId));
      let processed = 0;
      let duplicates = 0;
      const failures: Array<{ externalOrderId: string; error: string }> = [];

      for (const order of orders) {
        try {
          if (['UNPAID', 'PENDING'].includes(order.externalStatus.toUpperCase())) continue;
          const items = order.lines.map((line) => ({
            externalSkuId: line.candidates.find((candidate) => mapped.has(candidate)) ?? '',
            quantity: line.quantity,
            unitPrice: line.unitPrice,
          }));
          const missing = order.lines.filter((_line, index) => !items[index].externalSkuId).flatMap((line) => line.candidates.slice(0, 1));
          if (!items.length || missing.length) throw new Error(`SKU sàn chưa ánh xạ: ${missing.join(', ') || 'đơn không có dòng hàng hợp lệ'}`);
          const result = await this.sales.syncMarketplace(organizationId, `SYSTEM_ORDER_SYNC:${channel.id}`, {
            channelAccountId: channel.id,
            warehouseId: warehouse.id,
            externalOrderId: order.externalOrderId,
            customerName: order.customerName,
            orderedAt: order.orderedAt.toISOString(),
            externalStatus: order.externalStatus,
            items,
          });
          if (result.duplicated) duplicates += 1;
          await this.sales.syncMarketplaceStatus(organizationId, channel.id, `SYSTEM_ORDER_SYNC:${channel.id}`, {
            externalOrderId: order.externalOrderId,
            externalStatus: order.externalStatus,
            occurredAt: order.updatedAt.toISOString(),
          });
          processed += 1;
        } catch (reason) {
          failures.push({ externalOrderId: order.externalOrderId, error: this.message(reason) });
        }
      }

      const succeeded = failures.length === 0;
      const completedAt = new Date();
      await this.prisma.$transaction([
        this.prisma.channelSyncRun.update({ where: { id: run.id }, data: {
          status: succeeded ? ChannelSyncStatus.SUCCEEDED : ChannelSyncStatus.FAILED,
          processedCount: processed,
          failedCount: failures.length,
          snapshot: { fetched: orders.length, imported: processed, duplicates, failures },
          errorMessage: failures.length ? `${failures.length} đơn chưa nhập được; con trỏ được giữ để thử lại` : null,
          completedAt,
        } }),
        this.prisma.channelConnection.update({ where: { id: connection.id }, data: {
          orderSyncStatus: succeeded ? 'SUCCEEDED' : 'FAILED',
          orderSyncLeaseUntil: null,
          lastOrderSyncAt: completedAt,
          orderSyncCursorAt: succeeded ? now : connection.orderSyncCursorAt,
          orderSyncError: failures.length ? failures.slice(0, 5).map((item) => `${item.externalOrderId}: ${item.error}`).join(' | ') : null,
        } }),
      ]);
      return { runId: run.id, fetched: orders.length, imported: processed, duplicates, failures, cursorAdvanced: succeeded };
    } catch (reason) {
      const error = this.message(reason);
      await this.prisma.$transaction([
        this.prisma.channelSyncRun.update({ where: { id: run.id }, data: { status: ChannelSyncStatus.FAILED, failedCount: 1, errorMessage: error, completedAt: new Date() } }),
        this.prisma.channelConnection.update({ where: { id: connection.id }, data: { orderSyncStatus: 'FAILED', orderSyncLeaseUntil: null, orderSyncError: error, lastOrderSyncAt: new Date() } }),
      ]);
      throw new BadRequestException(`Không thể kéo đơn từ ${channel.name}: ${error}`);
    }
  }

  private async pullShopee(connection: NonNullable<Awaited<ReturnType<typeof this.connectionShape>>>, from: Date, to: Date) {
    const partnerId = Number(connection.clientId);
    const shopId = Number(connection.accountIdentifier);
    if (!Number.isSafeInteger(partnerId) || !Number.isSafeInteger(shopId) || !connection.clientSecretEncrypted || !connection.accessTokenEncrypted) throw new Error('Partner ID, Shop ID hoặc khóa Shopee không hợp lệ');
    const secret = this.cipher.decrypt(connection.clientSecretEncrypted);
    const token = this.cipher.decrypt(connection.accessTokenEncrypted);
    const host = (connection.apiBaseUrl?.trim() || (connection.environment === 'SANDBOX' ? 'https://partner.test-stable.shopeemobile.com' : 'https://partner.shopeemobile.com')).replace(/\/$/, '');
    const orderNumberSet = new Set<string>();
    for (let windowStart = from.getTime(); windowStart < to.getTime(); windowStart += 14 * 86_400_000) {
      const windowEnd = Math.min(to.getTime(), windowStart + 14 * 86_400_000);
      let cursor = '';
      for (let page = 0; page < 20; page += 1) {
        const payload = await this.shopeeGet(host, '/api/v2/order/get_order_list', partnerId, shopId, secret, token, {
          time_range_field: 'update_time', time_from: String(Math.floor(windowStart / 1000)), time_to: String(Math.floor(windowEnd / 1000)), page_size: '100', ...(cursor ? { cursor } : {}),
        });
        const response = this.object(payload.response);
        for (const item of this.array(response.order_list)) { const sn = this.string(this.object(item).order_sn); if (sn) orderNumberSet.add(sn); }
        if (!response.more) break;
        cursor = this.string(response.next_cursor);
        if (!cursor) throw new Error('Shopee báo còn trang nhưng không trả next_cursor');
        if (page === 19) throw new Error('Shopee trả quá 2.000 đơn trong một cửa sổ; cần thu hẹp thời gian đồng bộ');
      }
    }
    const orderNumbers = [...orderNumberSet];
    const result: PulledOrder[] = [];
    for (let offset = 0; offset < orderNumbers.length; offset += 50) {
      const payload = await this.shopeeGet(host, '/api/v2/order/get_order_detail', partnerId, shopId, secret, token, {
        order_sn_list: orderNumbers.slice(offset, offset + 50).join(','), response_optional_fields: 'item_list,buyer_user_id,buyer_username,recipient_address,total_amount,create_time,update_time',
      });
      for (const value of this.array(this.object(payload.response).order_list)) {
        const order = this.object(value); const address = this.object(order.recipient_address);
        const lines = this.array(order.item_list).map((entry) => { const item = this.object(entry); return {
          candidates: [item.model_id, item.model_sku, item.item_id, item.item_sku].map((v) => this.string(v)).filter(Boolean),
          quantity: this.number(item.model_quantity_purchased, 0), unitPrice: this.optionalNumber(item.model_discounted_price),
        }; }).filter((line) => line.quantity > 0);
        result.push({ externalOrderId: this.string(order.order_sn), externalStatus: this.string(order.order_status) || 'CONFIRMED', orderedAt: this.date(order.create_time), updatedAt: this.date(order.update_time), customerName: this.string(address.name) || this.string(order.buyer_username) || undefined, lines });
      }
    }
    return result.filter((order) => order.externalOrderId);
  }

  private async pullTikTok(connection: NonNullable<Awaited<ReturnType<typeof this.connectionShape>>>, from: Date, to: Date) {
    if (!connection.clientId || !connection.accountIdentifier || !connection.clientSecretEncrypted || !connection.accessTokenEncrypted) throw new Error('App Key, Shop Cipher hoặc khóa TikTok không hợp lệ');
    const secret = this.cipher.decrypt(connection.clientSecretEncrypted);
    const token = this.cipher.decrypt(connection.accessTokenEncrypted);
    const host = (process.env.TIKTOK_API_BASE_URL || connection.apiBaseUrl || 'https://open-api.tiktokglobalshop.com').replace(/\/$/, '');
    const path = '/order/202309/orders/search';
    const result: PulledOrder[] = [];
    let pageToken = '';
    for (let page = 0; page < 20; page += 1) {
      const body = { update_time_ge: Math.floor(from.getTime() / 1000), update_time_lt: Math.floor(to.getTime() / 1000) };
      const timestamp = String(Math.floor(Date.now() / 1000));
      const query: Record<string, string> = { app_key: connection.clientId, shop_cipher: connection.accountIdentifier, timestamp, page_size: '100', sort_field: 'update_time', sort_order: 'ASC', ...(pageToken ? { page_token: pageToken } : {}) };
      const bodyText = JSON.stringify(body);
      let input = path; for (const key of Object.keys(query).sort()) input += `${key}${query[key]}`;
      const sign = createHmac('sha256', secret).update(`${secret}${input}${bodyText}${secret}`).digest('hex');
      const url = new URL(`${host}${path}`); Object.entries({ ...query, sign }).forEach(([key, value]) => url.searchParams.set(key, value));
      const payload = await this.fetchObject(url, { method: 'POST', headers: { 'content-type': 'application/json', 'x-tts-access-token': token }, body: bodyText });
      if (Number(payload.code) !== 0) throw new Error(this.apiError(payload, 'TikTok từ chối yêu cầu danh sách đơn'));
      const data = this.object(payload.data);
      for (const value of this.array(data.orders)) {
        const order = this.object(value); const recipient = this.object(order.recipient_address);
        const lines = this.array(order.line_items).map((entry) => { const item = this.object(entry); return {
          candidates: [item.sku_id, item.seller_sku, item.product_id].map((v) => this.string(v)).filter(Boolean),
          quantity: this.number(item.quantity, 0), unitPrice: this.optionalNumber(item.sale_price) ?? this.optionalNumber(item.original_price),
        }; }).filter((line) => line.quantity > 0);
        result.push({ externalOrderId: this.string(order.id), externalStatus: this.string(order.status) || 'CONFIRMED', orderedAt: this.date(order.create_time), updatedAt: this.date(order.update_time), customerName: this.string(recipient.name) || this.string(this.object(order.buyer_info).name) || undefined, lines });
      }
      pageToken = this.string(data.next_page_token); if (!pageToken) break;
    }
    return result.filter((order) => order.externalOrderId);
  }

  private async shopeeGet(host: string, path: string, partnerId: number, shopId: number, secret: string, token: string, values: Record<string, string>) {
    const timestamp = Math.floor(Date.now() / 1000);
    const sign = createHmac('sha256', secret).update(`${partnerId}${path}${timestamp}${token}${shopId}`).digest('hex');
    const url = new URL(`${host}${path}`);
    Object.entries({ partner_id: String(partnerId), timestamp: String(timestamp), access_token: token, shop_id: String(shopId), sign, ...values }).forEach(([key, value]) => url.searchParams.set(key, value));
    const payload = await this.fetchObject(url, { method: 'GET' });
    if (this.string(payload.error)) throw new Error(this.apiError(payload, 'Shopee từ chối yêu cầu đơn hàng'));
    return payload;
  }

  private async fetchObject(url: URL, init: RequestInit) {
    const response = await fetch(url, { ...init, signal: AbortSignal.timeout(20_000) });
    const text = await response.text(); let payload: unknown;
    try { payload = text ? JSON.parse(text) : {}; } catch { throw new Error(`API trả dữ liệu không phải JSON (HTTP ${response.status})`); }
    if (!response.ok) throw new Error(this.apiError(this.object(payload), `HTTP ${response.status}`));
    return this.object(payload);
  }
  private connectionShape() { return this.prisma.channelConnection.findFirstOrThrow(); }
  private object(value: unknown): JsonObject { return value && typeof value === 'object' && !Array.isArray(value) ? value as JsonObject : {}; }
  private array(value: unknown): unknown[] { return Array.isArray(value) ? value : []; }
  private string(value: unknown): string { return typeof value === 'string' ? value.trim() : typeof value === 'number' || typeof value === 'bigint' ? String(value) : ''; }
  private number(value: unknown, fallback: number): number { const parsed = Number(value); return Number.isFinite(parsed) ? parsed : fallback; }
  private optionalNumber(value: unknown): number | undefined { const parsed = Number(value); return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined; }
  private date(value: unknown): Date { const numeric = Number(value); const date = Number.isFinite(numeric) && numeric > 0 ? new Date(numeric * 1000) : new Date(String(value ?? '')); return Number.isNaN(date.getTime()) ? new Date() : date; }
  private message(reason: unknown): string { return reason instanceof Error ? reason.message : String(reason); }
  private apiError(payload: JsonObject, fallback: string) { return this.string(payload.message) || this.string(payload.error) || fallback; }

  private async runWorker() {
    if (this.workerBusy) return;
    this.workerBusy = true;
    try { await this.processDue(undefined, 10); }
    catch (reason) { console.error('Marketplace order scheduler failed', reason); }
    finally { this.workerBusy = false; }
  }
}
