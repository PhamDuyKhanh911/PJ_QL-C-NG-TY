import { BadRequestException, ConflictException, Injectable, ServiceUnavailableException } from '@nestjs/common';
import { createHash, randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';
import { createReadStream, existsSync } from 'node:fs';
import { mkdir, readFile, readdir, rename, stat, unlink, writeFile } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { PrismaService } from '../prisma/prisma.service';

type BackupManifest = {
  fileName: string;
  createdAt: string;
  verifiedAt: string;
  sizeBytes: number;
  sha256: string;
  databaseName: string;
  databaseServer: string;
  requestedByUserId: string;
  format: 'postgres-custom';
  toolVersion: string;
};

type DatabaseConnection = { host: string; port: string; username: string; password: string; database: string };
const backupNamePattern = /^enterprise-\d{8}-\d{6}-[a-f0-9]{6}\.dump$/;

@Injectable()
export class BackupsService {
  private creating = false;
  constructor(private readonly prisma: PrismaService) {}

  async list() {
    const directory = this.backupDirectory();
    await mkdir(directory, { recursive: true });
    const files = await readdir(directory);
    const manifests = await Promise.all(files.filter((file) => file.endsWith('.json')).map(async (file) => {
      try {
        const manifest = JSON.parse(await readFile(join(directory, file), 'utf8')) as BackupManifest;
        if (!backupNamePattern.test(manifest.fileName) || file !== `${manifest.fileName}.json`) return null;
        const dump = await stat(join(directory, manifest.fileName));
        return { ...manifest, sizeBytes: dump.size };
      } catch { return null; }
    }));
    return manifests.filter((item): item is BackupManifest => item !== null).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async create(organizationId: string, requestedByUserId: string) {
    if (this.creating) throw new ConflictException('Một bản sao lưu khác đang được tạo. Vui lòng đợi hoàn tất.');
    this.creating = true;
    const directory = this.backupDirectory();
    await mkdir(directory, { recursive: true });
    const connection = this.connection();
    const createdAt = new Date();
    const fileName = `enterprise-${this.timestamp(createdAt)}-${randomBytes(3).toString('hex')}.dump`;
    const absolutePath = join(directory, fileName);
    const partialPath = `${absolutePath}.part`;
    try {
      const pgDump = this.postgresExecutable('pg_dump.exe');
      await this.run(pgDump, [
        '--format=custom', '--compress=6', '--no-owner', '--no-privileges',
        '--host', connection.host, '--port', connection.port, '--username', connection.username,
        '--dbname', connection.database, '--file', partialPath,
      ], connection.password);
      await this.inspect(partialPath, connection.password);
      await rename(partialPath, absolutePath);
      const file = await stat(absolutePath);
      const manifest: BackupManifest = {
        fileName,
        createdAt: createdAt.toISOString(),
        verifiedAt: new Date().toISOString(),
        sizeBytes: file.size,
        sha256: await this.hash(absolutePath),
        databaseName: connection.database,
        databaseServer: `${connection.host}:${connection.port}`,
        requestedByUserId,
        format: 'postgres-custom',
        toolVersion: await this.toolVersion(pgDump),
      };
      await this.writeManifest(manifest);
      await this.prisma.auditEvent.create({ data: { organizationId, actorId: requestedByUserId, category: 'BACKUP', action: 'BACKUP_CREATED', entityType: 'DATABASE_BACKUP', entityId: fileName, summary: 'Tạo và kiểm tra bản sao lưu toàn hệ thống', metadata: { fileName, sizeBytes: file.size, sha256: manifest.sha256 } } });
      return manifest;
    } catch (error) {
      await unlink(partialPath).catch(() => undefined);
      throw error;
    } finally { this.creating = false; }
  }

  async verify(fileName: string) {
    const manifest = await this.manifest(fileName);
    const absolutePath = this.backupPath(fileName);
    await this.inspect(absolutePath, this.connection().password);
    const sha256 = await this.hash(absolutePath);
    if (sha256 !== manifest.sha256) throw new ConflictException('Bản sao lưu đã thay đổi so với lúc được tạo. Không nên dùng để khôi phục.');
    const updated = { ...manifest, verifiedAt: new Date().toISOString(), sizeBytes: (await stat(absolutePath)).size };
    await this.writeManifest(updated);
    return updated;
  }

  async download(fileName: string) {
    await this.manifest(fileName);
    const absolutePath = this.backupPath(fileName);
    return { fileName, absolutePath, sizeBytes: (await stat(absolutePath)).size };
  }

  private async manifest(fileName: string) {
    const absolutePath = this.backupPath(fileName);
    try {
      const manifest = JSON.parse(await readFile(`${absolutePath}.json`, 'utf8')) as BackupManifest;
      if (manifest.fileName !== fileName) throw new Error('Manifest mismatch');
      return manifest;
    }
    catch { throw new BadRequestException('Không tìm thấy bản sao lưu hợp lệ.'); }
  }

  private backupPath(fileName: string) {
    if (!backupNamePattern.test(fileName) || basename(fileName) !== fileName) throw new BadRequestException('Tên bản sao lưu không hợp lệ.');
    return join(this.backupDirectory(), fileName);
  }

  private backupDirectory() {
    if (process.env.BACKUP_DIR) return resolve(process.env.BACKUP_DIR);
    const bin = dirname(this.postgresExecutable('pg_dump.exe'));
    return resolve(bin, '..', '..', '..', '.data', 'backups');
  }

  private postgresExecutable(name: string) {
    const configured = process.env.POSTGRES_BIN ? join(process.env.POSTGRES_BIN, name) : null;
    const candidates = [configured, resolve(process.cwd(), '.tools', 'pgsql', 'bin', name), resolve(process.cwd(), '..', '..', '.tools', 'pgsql', 'bin', name)];
    const selected = candidates.find((candidate): candidate is string => Boolean(candidate && existsSync(candidate)));
    if (!selected) throw new ServiceUnavailableException('Chưa cấu hình bộ công cụ PostgreSQL.');
    return selected;
  }

  private connection(): DatabaseConnection {
    const value = process.env.DATABASE_URL;
    if (!value) throw new ServiceUnavailableException('Chưa cấu hình kết nối cơ sở dữ liệu.');
    const url = new URL(value);
    return { host: url.hostname, port: url.port || '5432', username: decodeURIComponent(url.username), password: decodeURIComponent(url.password), database: decodeURIComponent(url.pathname.replace(/^\//, '')) };
  }

  private async inspect(absolutePath: string, password: string) {
    await this.run(this.postgresExecutable('pg_restore.exe'), ['--list', absolutePath], password);
  }

  private async run(executable: string, args: string[], password: string) {
    await new Promise<void>((resolvePromise, reject) => {
      const child = spawn(executable, args, { windowsHide: true, env: { ...process.env, PGPASSWORD: password } });
      let errors = '';
      child.stderr.on('data', (chunk: Buffer) => { if (errors.length < 8000) errors += chunk.toString(); });
      child.once('error', () => reject(new ServiceUnavailableException('Không thể chạy công cụ sao lưu PostgreSQL.')));
      child.once('close', (code) => code === 0 ? resolvePromise() : reject(new ServiceUnavailableException(errors.trim() || 'Công cụ sao lưu PostgreSQL báo lỗi.')));
    });
  }

  private async hash(absolutePath: string) {
    const digest = createHash('sha256');
    for await (const chunk of createReadStream(absolutePath)) digest.update(chunk);
    return digest.digest('hex');
  }

  private async writeManifest(manifest: BackupManifest) {
    const target = `${this.backupPath(manifest.fileName)}.json`;
    const partial = `${target}.part`;
    await writeFile(partial, JSON.stringify(manifest, null, 2), 'utf8');
    await rename(partial, target);
  }

  private async toolVersion(executable: string) {
    return new Promise<string>((resolvePromise) => {
      const child = spawn(executable, ['--version'], { windowsHide: true });
      let output = '';
      child.stdout.on('data', (chunk: Buffer) => { output += chunk.toString(); });
      child.once('error', () => resolvePromise('PostgreSQL tools'));
      child.once('close', () => resolvePromise(output.trim() || 'PostgreSQL tools'));
    });
  }

  private timestamp(date: Date) {
    const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Bangkok', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).formatToParts(date);
    const read = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? '00';
    return `${read('year')}${read('month')}${read('day')}-${read('hour')}${read('minute')}${read('second')}`;
  }
}
