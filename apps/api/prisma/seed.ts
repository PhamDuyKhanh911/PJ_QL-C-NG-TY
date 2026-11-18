import { ChannelType, PrismaClient } from '@prisma/client';
import { randomBytes, scrypt as nodeScrypt } from 'node:crypto';
import { promisify } from 'node:util';

const prisma = new PrismaClient();
const scrypt = promisify(nodeScrypt);

async function hashPassword(password: string) {
  const salt = randomBytes(16).toString('hex');
  const derived = (await scrypt(password, salt, 64)) as Buffer;
  return `scrypt:${salt}:${derived.toString('hex')}`;
}

async function main() {
  const organization = await prisma.organization.upsert({
    where: { code: 'DEMO' },
    update: {},
    create: { code: 'DEMO', name: 'Công ty Demo Đa Kênh' },
  });
  const role = await prisma.role.upsert({
    where: { organizationId_code: { organizationId: organization.id, code: 'OWNER' } },
    update: { permissions: ['*'] },
    create: { organizationId: organization.id, code: 'OWNER', name: 'Chủ doanh nghiệp', permissions: ['*'] },
  });
  const user = await prisma.user.upsert({
    where: { organizationId_email: { organizationId: organization.id, email: 'admin@local.test' } },
    update: { passwordHash: await hashPassword(process.env.SEED_ADMIN_PASSWORD ?? 'Admin@123456') },
    create: {
      organizationId: organization.id,
      email: 'admin@local.test',
      displayName: 'Quản trị viên',
      passwordHash: await hashPassword(process.env.SEED_ADMIN_PASSWORD ?? 'Admin@123456'),
    },
  });
  await prisma.userRoleAssignment.upsert({
    where: { id: `${user.id}-${role.id}` },
    update: {},
    create: { id: `${user.id}-${role.id}`, userId: user.id, roleId: role.id, scopeType: 'ORGANIZATION', scopeId: organization.id },
  });
  const channels: Array<[string, string, ChannelType]> = [
    ['TIKTOK_01', 'TikTok Seller 01', ChannelType.TIKTOK_SHOP],
    ['TIKTOK_02', 'TikTok Seller 02', ChannelType.TIKTOK_SHOP],
    ['TIKTOK_03', 'TikTok Seller 03', ChannelType.TIKTOK_SHOP],
    ['SHOPEE_01', 'Shopee Seller 01', ChannelType.SHOPEE],
    ['SHOPEE_02', 'Shopee Seller 02', ChannelType.SHOPEE],
    ['SHOPEE_03', 'Shopee Seller 03', ChannelType.SHOPEE],
  ];
  for (const [code, name, type] of channels) {
    await prisma.salesChannelAccount.upsert({
      where: { organizationId_code: { organizationId: organization.id, code } },
      update: { name, type },
      create: { organizationId: organization.id, code, name, type },
    });
  }
}

main().finally(() => prisma.$disconnect());
