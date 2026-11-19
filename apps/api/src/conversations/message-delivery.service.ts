import { Injectable, NotFoundException, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ChannelType } from '@prisma/client';
import { ChannelCredentialCipherService } from '../channels/channel-credential-cipher.service';
import { PrismaService } from '../prisma/prisma.service';

class ProviderDeliveryError extends Error {
  constructor(message: string, readonly retryable: boolean) {
    super(message);
  }
}

@Injectable()
export class MessageDeliveryService implements OnModuleInit, OnModuleDestroy {
  private worker?: NodeJS.Timeout;
  private workerBusy = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly credentials: ChannelCredentialCipherService,
  ) {}

  onModuleInit() {
    this.worker = setInterval(() => void this.runWorker(), 10_000);
    this.worker.unref();
  }

  onModuleDestroy() {
    if (this.worker) clearInterval(this.worker);
  }

  async processPending(organizationId?: string, limit = 20) {
    const now = new Date();
    const recovered = await this.prisma.message.updateMany({
      where: {
        direction: 'OUTBOUND',
        deliveryStatus: 'SENDING',
        nextDeliveryAttemptAt: { lte: now },
        ...(organizationId ? { conversation: { channelAccount: { organizationId } } } : {}),
      },
      data: {
        deliveryStatus: 'UNKNOWN',
        nextDeliveryAttemptAt: null,
        lastDeliveryError: 'Tiến trình gửi bị gián đoạn; cần kiểm tra trên kênh trước khi thử lại để tránh gửi trùng',
      },
    });
    const messages = await this.prisma.message.findMany({
      where: {
        direction: 'OUTBOUND',
        deliveryStatus: { in: ['QUEUED', 'FAILED'] },
        nextDeliveryAttemptAt: { lte: now },
        deliveryAttempts: { lt: 5 },
        ...(organizationId ? { conversation: { channelAccount: { organizationId } } } : {}),
      },
      orderBy: { sentAt: 'asc' },
      take: limit,
      select: { id: true },
    });
    const results = [];
    for (const message of messages) results.push(await this.processMessage(message.id));
    return {
      recoveredUnknown: recovered.count,
      selected: messages.length,
      sent: results.filter((message) => message?.deliveryStatus === 'SENT').length,
      failed: results.filter((message) => message?.deliveryStatus === 'FAILED').length,
      blocked: results.filter((message) => ['BLOCKED', 'UNSUPPORTED', 'UNKNOWN'].includes(message?.deliveryStatus ?? '')).length,
    };
  }

  async retry(organizationId: string, messageId: string) {
    const message = await this.prisma.message.findFirst({
      where: { id: messageId, direction: 'OUTBOUND', conversation: { channelAccount: { organizationId } } },
    });
    if (!message) throw new NotFoundException('Không tìm thấy tin nhắn gửi đi');
    await this.prisma.message.update({
      where: { id: message.id },
      data: {
        deliveryStatus: 'QUEUED',
        deliveryAttempts: 0,
        nextDeliveryAttemptAt: new Date(),
        deliveredAt: null,
        lastDeliveryError: null,
      },
    });
    return this.processMessage(message.id);
  }

  async processMessage(messageId: string) {
    const now = new Date();
    const claimed = await this.prisma.message.updateMany({
      where: {
        id: messageId,
        direction: 'OUTBOUND',
        deliveryStatus: { in: ['QUEUED', 'FAILED'] },
        nextDeliveryAttemptAt: { lte: now },
        deliveryAttempts: { lt: 5 },
      },
      data: {
        deliveryStatus: 'SENDING',
        deliveryAttempts: { increment: 1 },
        nextDeliveryAttemptAt: new Date(now.getTime() + 120_000),
        lastDeliveryError: null,
      },
    });
    if (!claimed.count) return this.prisma.message.findUnique({ where: { id: messageId } });

    const message = await this.prisma.message.findUniqueOrThrow({
      where: { id: messageId },
      include: {
        conversation: {
          include: {
            customerIdentity: true,
            channelAccount: { include: { connection: true } },
          },
        },
      },
    });
    const channel = message.conversation.channelAccount;
    if (channel.type !== ChannelType.FACEBOOK_MESSENGER) {
      return this.prisma.message.update({
        where: { id: message.id },
        data: {
          deliveryStatus: 'UNSUPPORTED',
          nextDeliveryAttemptAt: null,
          lastDeliveryError: `Kênh ${channel.type} chưa có adapter gửi tin chính thức`,
        },
      });
    }

    try {
      const externalId = await this.sendFacebook({
        pageId: channel.connection?.accountIdentifier,
        apiBaseUrl: channel.connection?.apiBaseUrl,
        accessTokenEncrypted: channel.connection?.accessTokenEncrypted,
        chatSyncEnabled: channel.connection?.chatSyncEnabled ?? false,
        recipientId: message.conversation.customerIdentity.externalBuyerId,
        content: message.content,
      });
      return this.prisma.message.update({
        where: { id: message.id },
        data: {
          externalId,
          deliveryStatus: 'SENT',
          deliveredAt: new Date(),
          nextDeliveryAttemptAt: null,
          lastDeliveryError: null,
        },
      });
    } catch (error) {
      const providerError = error instanceof ProviderDeliveryError ? error : null;
      const exhausted = message.deliveryAttempts >= 5;
      const retryable = providerError?.retryable === true && !exhausted;
      const ambiguous = !providerError;
      const retrySeconds = Math.min(3600, 30 * 2 ** Math.max(0, message.deliveryAttempts - 1));
      return this.prisma.message.update({
        where: { id: message.id },
        data: {
          deliveryStatus: ambiguous ? 'UNKNOWN' : retryable ? 'FAILED' : 'BLOCKED',
          nextDeliveryAttemptAt: retryable ? new Date(Date.now() + retrySeconds * 1_000) : null,
          lastDeliveryError: this.errorMessage(error, ambiguous),
        },
      });
    }
  }

  private async sendFacebook(input: {
    pageId?: string | null;
    apiBaseUrl?: string | null;
    accessTokenEncrypted?: string | null;
    chatSyncEnabled: boolean;
    recipientId: string;
    content: string;
  }) {
    if (!input.chatSyncEnabled) throw new ProviderDeliveryError('Kết nối Facebook chưa bật đồng bộ tin nhắn', false);
    if (!input.pageId || !input.accessTokenEncrypted) throw new ProviderDeliveryError('Kết nối Facebook thiếu Page ID hoặc Page Access Token', false);
    const accessToken = this.credentials.decrypt(input.accessTokenEncrypted);
    const baseUrl = (input.apiBaseUrl?.trim() || 'https://graph.facebook.com/v27.0').replace(/\/$/, '');
    const url = new URL(`${baseUrl}/${encodeURIComponent(input.pageId)}/messages`);
    url.searchParams.set('access_token', accessToken);
    let response: Response;
    try {
      response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          recipient: { id: input.recipientId },
          messaging_type: 'RESPONSE',
          message: { text: input.content },
        }),
        signal: AbortSignal.timeout(15_000),
      });
    } catch (error) {
      throw new Error(error instanceof Error ? `Không xác định được kết quả gửi: ${error.message}` : 'Không xác định được kết quả gửi tới Facebook');
    }
    const raw = await response.text();
    let payload: { message_id?: string; id?: string; error?: { message?: string } } = {};
    try { payload = raw ? JSON.parse(raw) : {}; } catch { payload = {}; }
    if (!response.ok) {
      const reason = payload.error?.message?.slice(0, 500) || `Facebook Graph API trả HTTP ${response.status}`;
      throw new ProviderDeliveryError(reason, response.status === 429 || response.status >= 500);
    }
    const externalId = payload.message_id || payload.id;
    if (!externalId) throw new Error('Facebook đã nhận yêu cầu nhưng không trả mã tin nhắn');
    return externalId;
  }

  private async runWorker() {
    if (this.workerBusy) return;
    this.workerBusy = true;
    try {
      await this.processPending(undefined, 20);
    } catch {
      // Tin nhắn vẫn nằm trong outbox và sẽ được xem xét lại ở lượt worker tiếp theo.
    } finally {
      this.workerBusy = false;
    }
  }

  private errorMessage(error: unknown, ambiguous: boolean) {
    const prefix = ambiguous ? 'Cần kiểm tra trên Facebook trước khi thử lại để tránh gửi trùng. ' : '';
    return `${prefix}${error instanceof Error ? error.message : 'Lỗi gửi tin không xác định'}`.slice(0, 1_000);
  }
}
