import { BadRequestException, Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ChannelConnectionStatus, ChannelSyncStatus, ChannelType, Prisma } from '@prisma/client';
import { createHmac } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';
import { ChannelCredentialCipherService } from './channel-credential-cipher.service';

type JsonObject = Record<string, unknown>;
type StockItem = { sku: string; externalProductId: string; externalSkuId: string; available: number };

@Injectable()
export class ChannelInventoryPushService implements OnModuleInit, OnModuleDestroy {
  private worker?: NodeJS.Timeout;
  private busy = false;

  constructor(private readonly prisma: PrismaService, private readonly cipher: ChannelCredentialCipherService) {}

  onModuleInit() {
    this.worker = setInterval(() => void this.runWorker(), 5_000);
    this.worker.unref();
  }

  onModuleDestroy() { if (this.worker) clearInterval(this.worker); }

  async processPending(organizationId?: string, limit = 10) {
    const now = new Date();
    const runs = await this.prisma.channelSyncRun.findMany({
      where: {
        status: ChannelSyncStatus.RUNNING,
        direction: { not: 'PULL_ORDERS' },
        nextAttemptAt: { lte: now },
        OR: [{ leaseUntil: null }, { leaseUntil: { lt: now } }],
        channelAccount: {
          active: true,
          type: { in: [ChannelType.SHOPEE, ChannelType.TIKTOK_SHOP] },
          ...(organizationId ? { organizationId } : {}),
          connection: { is: { status: ChannelConnectionStatus.READY, inventorySyncEnabled: true } },
        },
      },
      select: { id: true }, orderBy: { startedAt: 'asc' }, take: Math.min(Math.max(limit, 1), 50),
    });
    const results = [];
    for (const run of runs) results.push(await this.processRun(run.id));
    return { selected: runs.length, succeeded: results.filter((item) => item.status === ChannelSyncStatus.SUCCEEDED).length, failed: results.filter((item) => item.status === ChannelSyncStatus.FAILED).length, results };
  }

  async processRun(runId: string) {
    const now = new Date();
    const claimed = await this.prisma.channelSyncRun.updateMany({
      where: { id: runId, status: ChannelSyncStatus.RUNNING, OR: [{ leaseUntil: null }, { leaseUntil: { lt: now } }] },
      data: { leaseUntil: new Date(now.getTime() + 2 * 60_000), attempts: { increment: 1 }, errorMessage: null },
    });
    if (!claimed.count) return this.prisma.channelSyncRun.findUniqueOrThrow({ where: { id: runId } });
    const run = await this.prisma.channelSyncRun.findUniqueOrThrow({ where: { id: runId }, include: { channelAccount: { include: { connection: true } } } });
    const connection = run.channelAccount.connection;
    try {
      if (!connection?.inventorySyncEnabled || connection.status !== ChannelConnectionStatus.READY) throw new Error('Kết nối seller chưa sẵn sàng đồng bộ tồn kho');
      const items = this.stockItems(run.snapshot);
      if (!items.length) throw new Error('Lượt đồng bộ không có SKU hợp lệ');
      if (run.channelAccount.type === ChannelType.SHOPEE) await this.pushShopee(connection, items);
      else if (run.channelAccount.type === ChannelType.TIKTOK_SHOP) await this.pushTikTok(connection, items);
      else throw new Error('Kênh không hỗ trợ API tồn kho');
      return this.prisma.channelSyncRun.update({ where: { id: run.id }, data: { status: ChannelSyncStatus.SUCCEEDED, processedCount: items.length, failedCount: 0, leaseUntil: null, errorMessage: null, completedAt: new Date() } });
    } catch (reason) {
      const error = this.message(reason);
      const terminal = run.attempts >= 5;
      return this.prisma.channelSyncRun.update({ where: { id: run.id }, data: {
        status: terminal ? ChannelSyncStatus.FAILED : ChannelSyncStatus.RUNNING,
        failedCount: terminal ? run.mappedSkuCount : 0,
        leaseUntil: null,
        nextAttemptAt: new Date(Date.now() + Math.min(15 * 60_000, 15_000 * 2 ** Math.max(0, run.attempts - 1))),
        errorMessage: error,
        completedAt: terminal ? new Date() : null,
      } });
    }
  }

  private async pushShopee(connection: NonNullable<Awaited<ReturnType<typeof this.connectionShape>>>, items: StockItem[]) {
    const partnerId = Number(connection.clientId); const shopId = Number(connection.accountIdentifier);
    if (!Number.isSafeInteger(partnerId) || !Number.isSafeInteger(shopId) || !connection.clientSecretEncrypted || !connection.accessTokenEncrypted) throw new Error('Thiếu Partner ID, Shop ID hoặc khóa Shopee');
    const secret = this.cipher.decrypt(connection.clientSecretEncrypted); const token = this.cipher.decrypt(connection.accessTokenEncrypted);
    const host = (connection.apiBaseUrl?.trim() || (connection.environment === 'SANDBOX' ? 'https://partner.test-stable.shopeemobile.com' : 'https://partner.shopeemobile.com')).replace(/\/$/, '');
    const grouped = this.groupByProduct(items);
    for (const [externalProductId, productItems] of grouped) {
      const itemId = Number(externalProductId);
      if (!Number.isSafeInteger(itemId)) throw new Error(`Shopee Item ID không phải số nguyên an toàn: ${externalProductId}`);
      const stockList = productItems.map((item) => {
        const modelId = Number(item.externalSkuId);
        if (!Number.isSafeInteger(modelId)) throw new Error(`Shopee Model ID không phải số nguyên an toàn: ${item.externalSkuId}`);
        return { model_id: modelId, normal_stock: item.available };
      });
      const payload = await this.shopeePost(host, '/api/v2/product/update_stock', partnerId, shopId, secret, token, { item_id: itemId, stock_list: stockList });
      const failures = this.array(this.object(payload.response).failure_list);
      if (failures.length) throw new Error(`Shopee từ chối ${failures.length} SKU: ${JSON.stringify(failures).slice(0, 500)}`);
    }
  }

  private async pushTikTok(connection: NonNullable<Awaited<ReturnType<typeof this.connectionShape>>>, items: StockItem[]) {
    if (!connection.clientId || !connection.accountIdentifier || !connection.clientSecretEncrypted || !connection.accessTokenEncrypted) throw new Error('Thiếu App Key, Shop Cipher hoặc khóa TikTok');
    const secret = this.cipher.decrypt(connection.clientSecretEncrypted); const token = this.cipher.decrypt(connection.accessTokenEncrypted);
    const host = (process.env.TIKTOK_API_BASE_URL || connection.apiBaseUrl || 'https://open-api.tiktokglobalshop.com').replace(/\/$/, '');
    for (const [productId, productItems] of this.groupByProduct(items)) {
      const path = `/product/202309/products/${encodeURIComponent(productId)}/inventory/update`;
      const body = { skus: productItems.map((item) => ({ id: item.externalSkuId, inventory: [{ quantity: item.available }] })) };
      const payload = await this.tiktokPost(host, path, connection.clientId, connection.accountIdentifier, secret, token, body);
      const errors = this.array(this.object(payload.data).errors);
      if (errors.length) throw new Error(`TikTok từ chối ${errors.length} SKU: ${JSON.stringify(errors).slice(0, 500)}`);
    }
  }

  private async shopeePost(host: string, path: string, partnerId: number, shopId: number, secret: string, token: string, body: unknown) {
    const timestamp = Math.floor(Date.now() / 1000); const sign = createHmac('sha256', secret).update(`${partnerId}${path}${timestamp}${token}${shopId}`).digest('hex');
    const url = new URL(`${host}${path}`); Object.entries({ partner_id: String(partnerId), timestamp: String(timestamp), access_token: token, shop_id: String(shopId), sign }).forEach(([key, value]) => url.searchParams.set(key, value));
    const payload = await this.fetchObject(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    if (this.string(payload.error)) throw new Error(this.apiError(payload, 'Shopee từ chối cập nhật tồn kho'));
    return payload;
  }

  private async tiktokPost(host: string, path: string, appKey: string, shopCipher: string, secret: string, token: string, body: unknown) {
    const bodyText = JSON.stringify(body); const query = { app_key: appKey, shop_cipher: shopCipher, timestamp: String(Math.floor(Date.now() / 1000)) };
    let input = path; for (const key of Object.keys(query).sort() as Array<keyof typeof query>) input += `${key}${query[key]}`;
    const sign = createHmac('sha256', secret).update(`${secret}${input}${bodyText}${secret}`).digest('hex');
    const url = new URL(`${host}${path}`); Object.entries({ ...query, sign }).forEach(([key, value]) => url.searchParams.set(key, value));
    const payload = await this.fetchObject(url, { method: 'POST', headers: { 'content-type': 'application/json', 'x-tts-access-token': token }, body: bodyText });
    if (Number(payload.code) !== 0) throw new Error(this.apiError(payload, 'TikTok từ chối cập nhật tồn kho'));
    return payload;
  }

  private stockItems(snapshot: Prisma.JsonValue | null): StockItem[] {
    if (!Array.isArray(snapshot)) return [];
    return snapshot.map((value) => this.object(value)).map((item) => ({ sku: this.string(item.sku), externalProductId: this.string(item.externalProductId), externalSkuId: this.string(item.externalSkuId), available: Math.max(0, Math.floor(Number(item.available))) })).filter((item) => item.externalProductId && item.externalSkuId && Number.isFinite(item.available));
  }
  private groupByProduct(items: StockItem[]) { const grouped = new Map<string, StockItem[]>(); for (const item of items) grouped.set(item.externalProductId, [...(grouped.get(item.externalProductId) ?? []), item]); return grouped; }
  private async fetchObject(url: URL, init: RequestInit) { const response = await fetch(url, { ...init, signal: AbortSignal.timeout(20_000) }); const text = await response.text(); let value: unknown; try { value = text ? JSON.parse(text) : {}; } catch { throw new Error(`API trả dữ liệu không phải JSON (HTTP ${response.status})`); } const payload = this.object(value); if (!response.ok) throw new Error(this.apiError(payload, `HTTP ${response.status}`)); return payload; }
  private connectionShape() { return this.prisma.channelConnection.findFirstOrThrow(); }
  private object(value: unknown): JsonObject { return value && typeof value === 'object' && !Array.isArray(value) ? value as JsonObject : {}; }
  private array(value: unknown): unknown[] { return Array.isArray(value) ? value : []; }
  private string(value: unknown): string { return typeof value === 'string' ? value.trim() : typeof value === 'number' || typeof value === 'bigint' ? String(value) : ''; }
  private message(reason: unknown): string { return reason instanceof Error ? reason.message : String(reason); }
  private apiError(payload: JsonObject, fallback: string) { return this.string(payload.message) || this.string(payload.error) || fallback; }
  private async runWorker() { if (this.busy) return; this.busy = true; try { await this.processPending(undefined, 10); } catch (reason) { console.error('Marketplace inventory push worker failed', reason); } finally { this.busy = false; } }
}
