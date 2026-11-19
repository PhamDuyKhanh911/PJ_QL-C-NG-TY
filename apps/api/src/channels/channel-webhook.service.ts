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

    const eventType = this.eventType(body);
    const providerEventId = headers.providerEventId?.trim() || this.stringValue(body.eventId) || this.stringValue(body.id) || createHash('sha256').update(rawBody).digest('hex');
    try {
      const event = await this.prisma.channelWebhookEvent.create({
        data: {
          channelAccountId: channel.id,
          providerEventId,
          eventType,
          payload: body as Prisma.InputJsonObject,
          signatureVerified: true,
        },
      });
      return { accepted: true, duplicated: false, eventId: event.id, status: event.status };
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        const event = await this.prisma.channelWebhookEvent.findUniqueOrThrow({
          where: { channelAccountId_providerEventId: { channelAccountId: channel.id, providerEventId } },
        });
        return { accepted: true, duplicated: true, eventId: event.id, status: event.status };
      }
      throw error;
    }
  }

  async list(organizationId: string, query: ListChannelWebhookEventsDto) {
    const where: Prisma.ChannelWebhookEventWhereInput = {
      channelAccount: { organizationId },
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
      Promise.all(statuses.map((status) => this.prisma.channelWebhookEvent.count({ where: { channelAccount: { organizationId }, status } }))),
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

  async retry(organizationId: string, eventId: string) {
    const event = await this.prisma.channelWebhookEvent.findFirst({ where: { id: eventId, channelAccount: { organizationId } } });
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
    return this.stringValue(body.eventType) || this.stringValue(body.type) || this.stringValue(body.event) || 'UNKNOWN';
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
