import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  OnModuleDestroy,
  OnModuleInit,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { ChannelType, ChannelWebhookEventStatus, Prisma } from '@prisma/client';
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { channelScopeWhere, type DataScope } from '../auth/data-scope';
import { ConversationsService, InboundChannelMessage } from '../conversations/conversations.service';
import { PrismaService } from '../prisma/prisma.service';
import { SalesService } from '../sales/sales.service';
import { SyncMarketplaceOrderDto } from '../sales/dto/sync-marketplace-order.dto';
import { ChannelCredentialCipherService } from './channel-credential-cipher.service';
import { ListChannelWebhookEventsDto } from './dto/list-channel-webhook-events.dto';

type JsonObject = Record<string, unknown>;
type SignatureHeaders = {
  facebook?: string;
  channel?: string;
  providerEventId?: string;
};
type NormalizedWebhookEvent = {
  providerEventId: string;
  eventType: string;
  payload: JsonObject;
};

@Injectable()
export class ChannelWebhookService implements OnModuleInit, OnModuleDestroy {
  private worker?: NodeJS.Timeout;
  private workerBusy = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly credentials: ChannelCredentialCipherService,
    private readonly sales: SalesService,
    private readonly conversations: ConversationsService,
  ) {}

  onModuleInit() {
    this.worker = setInterval(() => void this.runWorker(), 5_000);
    this.worker.unref();
  }

  onModuleDestroy() {
    if (this.worker) clearInterval(this.worker);
  }

  async verifyFacebookChallenge(channelId: string, mode?: string, token?: string, challenge?: string) {
    if (mode !== 'subscribe' || !token || !challenge) throw new BadRequestException('Yêu cầu xác minh webhook không hợp lệ');
    const channel = await this.prisma.salesChannelAccount.findFirst({
      where: { id: channelId, active: true, type: ChannelType.FACEBOOK_MESSENGER },
      include: { connection: true },
    });
    if (!channel?.connection?.webhookSecretEncrypted) throw new NotFoundException('Kênh Facebook chưa cấu hình Webhook Secret');
    const expectedToken = this.credentials.decrypt(channel.connection.webhookSecretEncrypted);
    if (!this.safeEqual(expectedToken, token)) throw new ForbiddenException('Webhook verify token không chính xác');
    return challenge;
  }

  async receive(channelId: string, rawBody: Buffer, body: unknown, headers: SignatureHeaders) {
    if (!this.isObject(body)) throw new BadRequestException('Payload webhook phải là JSON object');
    const channel = await this.prisma.salesChannelAccount.findFirst({
      where: { id: channelId, active: true },
      include: { connection: true },
    });
    if (!channel) throw new NotFoundException('Không tìm thấy seller nhận webhook');
    if (!channel.connection) throw new ServiceUnavailableException('Seller chưa có cấu hình kết nối');
    this.verifySignature(channel.type, channel.connection, rawBody, headers);

    const events = channel.type === ChannelType.FACEBOOK_MESSENGER
      ? this.facebookEvents(body, rawBody, channel.connection.accountIdentifier)
      : [this.genericEvent(body, rawBody, headers.providerEventId)];
    const saved = [];
    for (const input of events) saved.push(await this.saveEvent(channel.id, input));
    return {
      accepted: true,
      received: saved.length,
      created: saved.filter((event) => !event.duplicated).length,
      duplicated: saved.filter((event) => event.duplicated).length,
      events: saved,
      ...(saved.length === 1 ? { eventId: saved[0].eventId, status: saved[0].status } : {}),
    };
  }

  async list(organizationId: string, query: ListChannelWebhookEventsDto, scope: DataScope) {
    const channelAccount = channelScopeWhere(organizationId, scope);
    const where: Prisma.ChannelWebhookEventWhereInput = {
      channelAccount,
      ...(query.channelAccountId ? { channelAccountId: query.channelAccountId } : {}),
      ...(query.status !== 'ALL' ? { status: query.status as ChannelWebhookEventStatus } : {}),
    };
    const statuses = Object.values(ChannelWebhookEventStatus);
    const [events, counts] = await Promise.all([
      this.prisma.channelWebhookEvent.findMany({
        where,
        select: {
          id: true,
          providerEventId: true,
          eventType: true,
          status: true,
          signatureVerified: true,
          attempts: true,
          maxAttempts: true,
          nextAttemptAt: true,
          errorMessage: true,
          receivedAt: true,
          processedAt: true,
          channelAccount: { select: { id: true, code: true, name: true, type: true } },
        },
        orderBy: { receivedAt: 'desc' },
        take: query.limit,
      }),
      Promise.all(statuses.map((status) => this.prisma.channelWebhookEvent.count({ where: { channelAccount, status } }))),
    ]);
    const summary = Object.fromEntries(statuses.map((status, index) => [status, counts[index]])) as Record<ChannelWebhookEventStatus, number>;
    return { events, summary, total: Object.values(summary).reduce((sum, value) => sum + value, 0) };
  }

  async processPending(organizationId?: string, limit = 20) {
    const now = new Date();
    const recovered = await this.prisma.channelWebhookEvent.updateMany({
      where: {
        ...(organizationId ? { channelAccount: { organizationId } } : {}),
        status: ChannelWebhookEventStatus.PROCESSING,
        updatedAt: { lt: new Date(now.getTime() - 120_000) },
      },
      data: {
        status: ChannelWebhookEventStatus.FAILED,
        errorMessage: 'Worker trước bị gián đoạn; sự kiện đã được đưa lại vào hàng đợi',
        nextAttemptAt: now,
      },
    });
    const events = await this.prisma.channelWebhookEvent.findMany({
      where: {
        ...(organizationId ? { channelAccount: { organizationId } } : {}),
        status: { in: [ChannelWebhookEventStatus.PENDING, ChannelWebhookEventStatus.FAILED] },
        nextAttemptAt: { lte: now },
        attempts: { lt: 5 },
      },
      orderBy: { receivedAt: 'asc' },
      take: limit,
      select: { id: true },
    });
    const results = [];
    for (const event of events) results.push(await this.processEvent(event.id));
    return {
      recovered: recovered.count,
      selected: events.length,
      processed: results.filter((item) => item?.status === ChannelWebhookEventStatus.PROCESSED).length,
      ignored: results.filter((item) => item?.status === ChannelWebhookEventStatus.IGNORED).length,
      failed: results.filter((item) => item?.status === ChannelWebhookEventStatus.FAILED).length,
    };
  }

  async retry(organizationId: string, eventId: string, scope: DataScope) {
    const event = await this.prisma.channelWebhookEvent.findFirst({ where: { id: eventId, channelAccount: channelScopeWhere(organizationId, scope) } });
    if (!event) throw new NotFoundException('Không tìm thấy sự kiện tích hợp');
    await this.prisma.channelWebhookEvent.update({
      where: { id: event.id },
      data: { status: ChannelWebhookEventStatus.PENDING, attempts: 0, nextAttemptAt: new Date(), errorMessage: null, processedAt: null },
    });
    return this.processEvent(event.id);
  }

  private async runWorker() {
    if (this.workerBusy) return;
    this.workerBusy = true;
    try {
      await this.processPending(undefined, 20);
    } catch {
      // A durable event remains in the database and will be retried on the next worker tick.
    } finally {
      this.workerBusy = false;
    }
  }

  private async processEvent(eventId: string) {
    const claimed = await this.prisma.channelWebhookEvent.updateMany({
      where: {
        id: eventId,
        status: { in: [ChannelWebhookEventStatus.PENDING, ChannelWebhookEventStatus.FAILED] },
      },
      data: { status: ChannelWebhookEventStatus.PROCESSING, attempts: { increment: 1 }, errorMessage: null },
    });
    if (!claimed.count) return this.prisma.channelWebhookEvent.findUnique({ where: { id: eventId } });
    const event = await this.prisma.channelWebhookEvent.findUniqueOrThrow({
      where: { id: eventId },
      include: { channelAccount: { include: { connection: true } } },
    });
    try {
      const outcome = await this.dispatch(event);
      return this.prisma.channelWebhookEvent.update({
        where: { id: event.id },
        data: {
          status: outcome.ignored ? ChannelWebhookEventStatus.IGNORED : ChannelWebhookEventStatus.PROCESSED,
          processedAt: new Date(),
          errorMessage: outcome.note ?? null,
        },
      });
    } catch (error) {
      const retrySeconds = Math.min(900, 30 * 2 ** Math.max(0, event.attempts - 1));
      return this.prisma.channelWebhookEvent.update({
        where: { id: event.id },
        data: {
          status: ChannelWebhookEventStatus.FAILED,
          errorMessage: this.errorMessage(error),
          nextAttemptAt: new Date(Date.now() + retrySeconds * 1_000),
        },
      });
    }
  }

  private async dispatch(event: Prisma.ChannelWebhookEventGetPayload<{ include: { channelAccount: { include: { connection: true } } } }>) {
    const payload = event.payload as JsonObject;
    const data = this.isObject(payload.data) ? payload.data : payload;
    const type = event.eventType.toUpperCase().replaceAll('.', '_').replaceAll('-', '_');
    if (['PING', 'WEBHOOK_TEST', 'CONNECTION_TEST'].includes(type)) return { ignored: false, note: 'Webhook test hợp lệ' };
    if (['71', 'INVENTORY_CHANGED', 'INVENTORY_CHANGED_BY_SHOP', 'STOCK_UPDATED', 'ITEM_STOCK_UPDATED', 'SKU_STOCK_UPDATED'].includes(type)) {
      return this.reconcileInventory(event, data);
    }
    if (['ORDER_CREATED', 'ORDER_UPSERT', 'ORDER_CONFIRMED'].includes(type)) {
      const input = this.marketplaceOrder(event.channelAccountId, data);
      await this.sales.syncMarketplace(event.channelAccount.organizationId, `SYSTEM_WEBHOOK:${event.channelAccountId}`, input);
      return { ignored: false, note: null };
    }
    const performedById = `SYSTEM_WEBHOOK:${event.channelAccountId}`;
    if (['ORDER_CANCELLED', 'ORDER_CANCELED', 'ORDER_CANCEL'].includes(type)) {
      const statusInput = this.marketplaceStatus(data, 'CANCELLED');
      const result = await this.sales.syncMarketplaceStatus(event.channelAccount.organizationId, event.channelAccountId, performedById, statusInput);
      if (result.action === 'RETURN_PROCESS_REQUIRED') {
        const returnResult = await this.sales.registerMarketplaceReturn(event.channelAccount.organizationId, event.channelAccountId, performedById, {
          externalOrderId: statusInput.externalOrderId,
          sourceEventId: event.providerEventId,
          reasonCode: statusInput.reasonCode ?? 'CHANNEL_CANCEL_AFTER_DISPATCH',
          occurredAt: statusInput.occurredAt,
        });
        return { ignored: false, note: returnResult.action };
      }
      return { ignored: false, note: result.note ?? result.action };
    }
    if (['ORDER_SHIPPED', 'ORDER_DELIVERED', 'ORDER_STATUS_UPDATED', 'ORDER_UPDATED'].includes(type)) {
      const fallback = type === 'ORDER_SHIPPED' ? 'SHIPPED' : type === 'ORDER_DELIVERED' ? 'DELIVERED' : undefined;
      const result = await this.sales.syncMarketplaceStatus(event.channelAccount.organizationId, event.channelAccountId, performedById, this.marketplaceStatus(data, fallback));
      return { ignored: false, note: result.note ?? result.action };
    }
    if (['RETURN_REQUESTED', 'ORDER_RETURN_REQUESTED', 'RETURN_CREATED', 'ORDER_RETURNED'].includes(type)) {
      const result = await this.sales.registerMarketplaceReturn(event.channelAccount.organizationId, event.channelAccountId, performedById, this.marketplaceReturn(data, event.providerEventId));
      return { ignored: false, note: result.action };
    }
    if (['MESSAGE_RECEIVED', 'INBOUND_MESSAGE', 'MESSAGING_MESSAGE'].includes(type)) {
      const input = this.inboundMessage(data);
      await this.conversations.ingestInbound(event.channelAccount.organizationId, event.channelAccountId, input);
      return { ignored: false, note: null };
    }
    return { ignored: true, note: `Chưa có adapter cho loại sự kiện ${event.eventType}` };
  }

  private async reconcileInventory(
    event: Prisma.ChannelWebhookEventGetPayload<{ include: { channelAccount: { include: { connection: true } } } }>,
    data: JsonObject,
  ) {
    const observations = this.inventoryObservations(data);
    if (!observations.length) throw new BadRequestException('Sự kiện tồn kho không chứa SKU và số lượng hợp lệ');
    const mappings = await this.prisma.channelSkuMapping.findMany({
      where: {
        channelAccountId: event.channelAccountId,
        externalSkuId: { in: observations.map((item) => item.externalSkuId) },
      },
      include: { variant: { include: { product: true, balances: true } } },
    });
    const mappingBySku = new Map(mappings.map((mapping) => [mapping.externalSkuId, mapping]));
    let matched = 0;
    let mismatch = 0;
    let unmapped = 0;
    let stale = 0;
    for (const observation of observations) {
      const current = await this.prisma.channelInventoryReconciliation.findUnique({
        where: { channelAccountId_externalSkuId: { channelAccountId: event.channelAccountId, externalSkuId: observation.externalSkuId } },
        select: { observedAt: true },
      });
      if (current && current.observedAt > observation.observedAt) {
        stale += 1;
        continue;
      }
      const mapping = mappingBySku.get(observation.externalSkuId);
      const expectedAvailable = mapping
        ? (mapping.variant.product.active
            ? mapping.variant.balances.reduce(
                (sum, balance) => sum + Math.max(0, balance.onHand - balance.reserved - balance.quarantined - balance.safetyStock),
                0,
              )
            : 0)
        : null;
      const difference = expectedAvailable === null ? null : observation.reportedAvailable - expectedAvailable;
      const status = expectedAvailable === null ? 'UNMAPPED' : difference === 0 ? 'MATCHED' : 'MISMATCH';
      if (status === 'MATCHED') matched += 1;
      else if (status === 'MISMATCH') mismatch += 1;
      else unmapped += 1;
      await this.prisma.channelInventoryReconciliation.upsert({
        where: { channelAccountId_externalSkuId: { channelAccountId: event.channelAccountId, externalSkuId: observation.externalSkuId } },
        create: {
          channelAccountId: event.channelAccountId,
          externalProductId: observation.externalProductId,
          externalSkuId: observation.externalSkuId,
          reportedAvailable: observation.reportedAvailable,
          expectedAvailable,
          difference,
          status,
          observedAt: observation.observedAt,
          sourceEventId: event.providerEventId,
          source: observation.source,
          details: observation.details as Prisma.InputJsonObject,
        },
        update: {
          externalProductId: observation.externalProductId,
          reportedAvailable: observation.reportedAvailable,
          expectedAvailable,
          difference,
          status,
          observedAt: observation.observedAt,
          sourceEventId: event.providerEventId,
          source: observation.source,
          details: observation.details as Prisma.InputJsonObject,
        },
      });
    }
    return {
      ignored: false,
      note: `Đối chiếu tồn kho: ${matched} khớp, ${mismatch} chênh lệch, ${unmapped} SKU chưa ghép, ${stale} sự kiện cũ được bỏ qua. Không thay đổi tồn ERP.`,
    };
  }

  private marketplaceOrder(channelAccountId: string, data: JsonObject): SyncMarketplaceOrderDto {
    const rawItems = Array.isArray(data.items) ? data.items : [];
    const items = rawItems.filter(this.isObject).map((item) => ({
      externalSkuId: this.stringValue(item.externalSkuId),
      quantity: Number(item.quantity),
    }));
    const input: SyncMarketplaceOrderDto = {
      channelAccountId,
      externalOrderId: this.stringValue(data.externalOrderId),
      warehouseId: this.stringValue(data.warehouseId),
      customerName: this.optionalString(data.customerName),
      orderedAt: this.stringValue(data.orderedAt),
      items,
    };
    if (!input.externalOrderId || !input.warehouseId || !input.orderedAt || !items.length || items.some((item) => !item.externalSkuId || !Number.isInteger(item.quantity) || item.quantity < 1)) {
      throw new BadRequestException('Sự kiện đơn hàng thiếu externalOrderId, warehouseId, orderedAt hoặc danh sách SKU hợp lệ');
    }
    return input;
  }

  private inboundMessage(data: JsonObject): InboundChannelMessage {
    const input: InboundChannelMessage = {
      externalConversationId: this.stringValue(data.externalConversationId),
      externalMessageId: this.stringValue(data.externalMessageId),
      externalBuyerId: this.stringValue(data.externalBuyerId),
      customerName: this.optionalString(data.customerName),
      content: this.stringValue(data.content),
      sentAt: this.stringValue(data.sentAt),
    };
    if (!input.externalConversationId || !input.externalMessageId || !input.externalBuyerId || !input.content || !input.sentAt) {
      throw new BadRequestException('Sự kiện tin nhắn thiếu mã hội thoại, mã tin, người gửi, nội dung hoặc thời gian');
    }
    return input;
  }

  private marketplaceStatus(data: JsonObject, fallbackStatus?: string) {
    const externalOrderId = this.stringValue(data.externalOrderId);
    const externalStatus = this.stringValue(data.externalStatus) || fallbackStatus || '';
    if (!externalOrderId || !externalStatus) throw new BadRequestException('Sự kiện trạng thái thiếu externalOrderId hoặc externalStatus');
    return {
      externalOrderId,
      externalStatus,
      occurredAt: this.optionalString(data.occurredAt),
      reasonCode: this.optionalString(data.reasonCode),
    };
  }

  private marketplaceReturn(data: JsonObject, sourceEventId: string) {
    const externalOrderId = this.stringValue(data.externalOrderId);
    if (!externalOrderId) throw new BadRequestException('Sự kiện hoàn thiếu externalOrderId');
    const rawItems = Array.isArray(data.items) ? data.items : [];
    const items = rawItems.filter(this.isObject).map((item) => ({
      externalSkuId: this.stringValue(item.externalSkuId),
      quantity: Number(item.quantity),
    }));
    if (items.some((item) => !item.externalSkuId || !Number.isInteger(item.quantity) || item.quantity < 1)) throw new BadRequestException('Sự kiện hoàn chứa SKU hoặc số lượng không hợp lệ');
    return {
      externalOrderId,
      sourceEventId,
      reasonCode: this.optionalString(data.reasonCode),
      occurredAt: this.optionalString(data.occurredAt),
      items: items.length ? items : undefined,
    };
  }

  private inventoryObservations(data: JsonObject) {
    const candidates: JsonObject[] = [data];
    for (const key of ['skus', 'items', 'inventory_list', 'stock_list']) {
      const value = data[key];
      if (Array.isArray(value)) candidates.push(...value.filter((item): item is JsonObject => this.isObject(item)));
    }
    if (this.isObject(data.sku)) candidates.push(data.sku);
    const observations = candidates.flatMap((item) => {
      const detail = this.isObject(item.quantity_snapshot_after_change) ? item.quantity_snapshot_after_change : undefined;
      const rawChangeDetail = item.change_detail ?? data.change_detail;
      const changeDetail = this.isObject(rawChangeDetail)
        ? rawChangeDetail
        : Array.isArray(rawChangeDetail)
          ? rawChangeDetail.find((value): value is JsonObject => this.isObject(value))
          : undefined;
      const externalSkuId = this.identifier(item.externalSkuId)
        || this.identifier(item.sku_id)
        || this.identifier(item.model_id)
        || this.identifier(detail?.sku_id);
      const reportedAvailable = this.firstNumber([
        detail?.available_quantity,
        detail?.available,
        detail?.total_available_quantity,
        detail?.seller_available_quantity,
        item.reportedAvailable,
        item.available_quantity,
        item.available,
        item.normal_stock,
        item.current_stock,
        item.stock,
      ]);
      if (!externalSkuId || reportedAvailable === undefined || !Number.isInteger(reportedAvailable) || reportedAvailable < 0) return [];
      const occurredAt = item.occur_time ?? item.occurred_at ?? data.occur_time ?? data.timestamp;
      return [{
        externalProductId: this.identifier(item.externalProductId) || this.identifier(item.product_id) || this.identifier(item.item_id) || undefined,
        externalSkuId,
        reportedAvailable,
        observedAt: this.webhookDate(occurredAt),
        source: this.optionalString(changeDetail?.trigger_source) || this.optionalString(changeDetail?.source),
        details: item,
      }];
    });
    return Array.from(new Map(observations.map((item) => [item.externalSkuId, item])).values());
  }

  private async saveEvent(channelAccountId: string, input: NormalizedWebhookEvent) {
    try {
      const event = await this.prisma.channelWebhookEvent.create({
        data: {
          channelAccountId,
          providerEventId: input.providerEventId,
          eventType: input.eventType,
          payload: input.payload as Prisma.InputJsonObject,
          signatureVerified: true,
        },
      });
      return { duplicated: false, eventId: event.id, status: event.status, eventType: event.eventType };
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        const event = await this.prisma.channelWebhookEvent.findUniqueOrThrow({
          where: { channelAccountId_providerEventId: { channelAccountId, providerEventId: input.providerEventId } },
        });
        return { duplicated: true, eventId: event.id, status: event.status, eventType: event.eventType };
      }
      throw error;
    }
  }

  private genericEvent(body: JsonObject, rawBody: Buffer, headerEventId?: string): NormalizedWebhookEvent {
    const data = this.isObject(body.data) ? body.data : undefined;
    return {
      eventType: this.eventType(body),
      providerEventId: headerEventId?.trim()
        || this.identifier(body.event_id)
        || this.identifier(data?.event_id)
        || this.identifier(body.tts_notification_id)
        || this.identifier(body.eventId)
        || this.identifier(body.id)
        || createHash('sha256').update(rawBody).digest('hex'),
      payload: body,
    };
  }

  private facebookEvents(body: JsonObject, rawBody: Buffer, configuredPageId?: string | null): NormalizedWebhookEvent[] {
    if (body.object !== 'page' || !Array.isArray(body.entry)) throw new BadRequestException('Payload Facebook phải có object=page và danh sách entry');
    const bodyHash = createHash('sha256').update(rawBody).digest('hex');
    const result: NormalizedWebhookEvent[] = [];
    body.entry.forEach((rawEntry, entryIndex) => {
      if (!this.isObject(rawEntry)) throw new BadRequestException('Facebook entry không hợp lệ');
      const pageId = this.stringValue(rawEntry.id);
      if (configuredPageId && pageId !== configuredPageId) throw new ForbiddenException('Page ID trong webhook không khớp seller được cấu hình');
      if (!Array.isArray(rawEntry.messaging)) return;
      rawEntry.messaging.forEach((rawMessaging, messagingIndex) => {
        if (!this.isObject(rawMessaging)) return;
        result.push(this.facebookMessagingEvent(rawMessaging, pageId, bodyHash, entryIndex, messagingIndex));
      });
    });
    if (!result.length) throw new BadRequestException('Webhook Facebook không chứa sự kiện messaging');
    return result;
  }

  private facebookMessagingEvent(messaging: JsonObject, pageId: string, bodyHash: string, entryIndex: number, messagingIndex: number): NormalizedWebhookEvent {
    const sender = this.isObject(messaging.sender) ? messaging.sender : {};
    const recipient = this.isObject(messaging.recipient) ? messaging.recipient : {};
    const message = this.isObject(messaging.message) ? messaging.message : undefined;
    const postback = this.isObject(messaging.postback) ? messaging.postback : undefined;
    const senderId = this.stringValue(sender.id);
    const recipientId = this.stringValue(recipient.id);
    const timestamp = Number(messaging.timestamp);
    const sentAt = Number.isFinite(timestamp) && timestamp > 0 ? new Date(timestamp).toISOString() : new Date().toISOString();
    const fallbackId = `facebook:${bodyHash}:${entryIndex}:${messagingIndex}`;

    if (message) {
      const messageId = this.stringValue(message.mid) || fallbackId;
      if (message.is_echo === true || senderId === pageId) {
        return { providerEventId: messageId, eventType: 'FACEBOOK_MESSAGE_ECHO', payload: { data: { pageId, senderId, recipientId, sentAt } } };
      }
      const content = this.facebookMessageContent(message);
      return {
        providerEventId: messageId,
        eventType: 'MESSAGE_RECEIVED',
        payload: {
          data: {
            externalConversationId: senderId,
            externalMessageId: messageId,
            externalBuyerId: senderId,
            content,
            sentAt,
            pageId,
            recipientId,
          },
        },
      };
    }
    if (postback) {
      const postbackId = this.stringValue(postback.mid) || fallbackId;
      const content = this.stringValue(postback.title) || this.stringValue(postback.payload) || '[Khách đã chọn một nút tương tác]';
      return {
        providerEventId: postbackId,
        eventType: 'MESSAGE_RECEIVED',
        payload: { data: { externalConversationId: senderId, externalMessageId: postbackId, externalBuyerId: senderId, content, sentAt, pageId, recipientId } },
      };
    }
    if (this.isObject(messaging.delivery)) {
      const mids = Array.isArray(messaging.delivery.mids) ? messaging.delivery.mids.filter((value): value is string => typeof value === 'string') : [];
      return { providerEventId: mids[0] ? `delivery:${mids[0]}` : fallbackId, eventType: 'FACEBOOK_MESSAGE_DELIVERED', payload: { data: { pageId, senderId, recipientId, sentAt, messageIds: mids } } };
    }
    if (this.isObject(messaging.read)) {
      return { providerEventId: `read:${senderId}:${String(messaging.read.watermark ?? (timestamp || bodyHash))}`, eventType: 'FACEBOOK_MESSAGE_READ', payload: { data: { pageId, senderId, recipientId, sentAt, watermark: messaging.read.watermark } } };
    }
    return { providerEventId: fallbackId, eventType: 'FACEBOOK_MESSAGING_UNKNOWN', payload: { data: { pageId, senderId, recipientId, sentAt } } };
  }

  private facebookMessageContent(message: JsonObject) {
    const text = this.stringValue(message.text);
    if (text) return text;
    const attachments = Array.isArray(message.attachments) ? message.attachments.filter(this.isObject) : [];
    if (attachments.length) {
      const types = attachments.map((attachment) => this.stringValue(attachment.type) || 'file');
      return `[Khách gửi tệp đính kèm: ${types.join(', ')}]`;
    }
    return '[Tin nhắn Facebook không có nội dung văn bản]';
  }

  private verifySignature(
    type: ChannelType,
    connection: { clientSecretEncrypted: string | null; webhookSecretEncrypted: string | null },
    rawBody: Buffer,
    headers: SignatureHeaders,
  ) {
    let supplied = headers.channel;
    let encryptedSecret = connection.webhookSecretEncrypted;
    if (type === ChannelType.FACEBOOK_MESSENGER && headers.facebook) {
      supplied = headers.facebook;
      encryptedSecret = connection.clientSecretEncrypted;
    }
    if (!supplied || !encryptedSecret) throw new UnauthorizedException('Thiếu chữ ký webhook hoặc khóa xác thực');
    const secret = this.credentials.decrypt(encryptedSecret);
    const expected = `sha256=${createHmac('sha256', secret).update(rawBody).digest('hex')}`;
    if (!this.safeEqual(expected, supplied)) throw new UnauthorizedException('Chữ ký webhook không hợp lệ');
  }

  private eventType(body: JsonObject) {
    return this.identifier(body.event_type) || this.identifier(body.eventType) || this.identifier(body.type) || this.identifier(body.event) || 'UNKNOWN';
  }

  private identifier(value: unknown) {
    if (typeof value === 'string') return value.trim();
    if (typeof value === 'number' && Number.isFinite(value)) return String(value);
    if (typeof value === 'bigint') return String(value);
    return '';
  }

  private firstNumber(values: unknown[]) {
    for (const value of values) {
      const normalized = typeof value === 'number' ? value : typeof value === 'string' && value.trim() ? Number(value) : Number.NaN;
      if (Number.isFinite(normalized)) return normalized;
    }
    return undefined;
  }

  private webhookDate(value: unknown) {
    if (value instanceof Date && !Number.isNaN(value.getTime())) return value;
    if (typeof value === 'number' || (typeof value === 'string' && value.trim())) {
      const numeric = Number(value);
      if (Number.isFinite(numeric) && numeric > 0) {
        const date = new Date(numeric < 10_000_000_000 ? numeric * 1_000 : numeric);
        if (!Number.isNaN(date.getTime())) return date;
      }
      const date = new Date(String(value));
      if (!Number.isNaN(date.getTime())) return date;
    }
    return new Date();
  }

  private stringValue(value: unknown) {
    return typeof value === 'string' ? value.trim() : '';
  }

  private optionalString(value: unknown) {
    const normalized = this.stringValue(value);
    return normalized || undefined;
  }

  private isObject(value: unknown): value is JsonObject {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
  }

  private safeEqual(expected: string, supplied: string) {
    const left = Buffer.from(expected);
    const right = Buffer.from(supplied);
    return left.length === right.length && timingSafeEqual(left, right);
  }

  private errorMessage(error: unknown) {
    if (error instanceof Error) return error.message.slice(0, 1_000);
    return 'Lỗi xử lý sự kiện không xác định';
  }
}
