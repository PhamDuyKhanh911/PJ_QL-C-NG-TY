import { Injectable } from '@nestjs/common';
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

@Injectable()
export class ChannelCredentialCipherService {
  private readonly key: Buffer;

  constructor() {
    const configuredKey = process.env.CHANNEL_CREDENTIAL_KEY;
    const fallbackKey = process.env.NODE_ENV === 'production' ? undefined : process.env.JWT_SECRET;
    const source = configuredKey ?? fallbackKey;
    if (!source || source.length < 24) throw new Error('CHANNEL_CREDENTIAL_KEY phải có ít nhất 24 ký tự');
    this.key = createHash('sha256').update(source).digest();
  }

  encrypt(value: string) {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    const encrypted = Buffer.concat([cipher.update(value.trim(), 'utf8'), cipher.final()]);
    return `v1:${iv.toString('base64url')}:${cipher.getAuthTag().toString('base64url')}:${encrypted.toString('base64url')}`;
  }

  decrypt(payload: string) {
    const [version, ivValue, tagValue, encryptedValue] = payload.split(':');
    if (version !== 'v1' || !ivValue || !tagValue || !encryptedValue) throw new Error('Định dạng thông tin xác thực không hợp lệ');
    const decipher = createDecipheriv('aes-256-gcm', this.key, Buffer.from(ivValue, 'base64url'));
    decipher.setAuthTag(Buffer.from(tagValue, 'base64url'));
    return Buffer.concat([decipher.update(Buffer.from(encryptedValue, 'base64url')), decipher.final()]).toString('utf8');
  }
}
