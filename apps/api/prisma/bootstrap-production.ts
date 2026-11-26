import { ChannelType, PrismaClient } from '@prisma/client';
import { randomBytes, scrypt as nodeScrypt } from 'node:crypto';
import { promisify } from 'node:util';

const prisma = new PrismaClient();
const scrypt = promisify(nodeScrypt);

function required(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Thiếu biến môi trường ${name}`);
  return value;
}

async function hashPassword(password: string) {
  const salt = randomBytes(16).toString('hex');
  const derived = (await scrypt(password, salt, 64)) as Buffer;
  return `scrypt:${salt}:${derived.toString('hex')}`;
}

async function main() {
  if (process.env.NODE_ENV !== 'production') throw new Error('Bootstrap production chỉ được chạy khi NODE_ENV=production');
  const organizationCode = required('BOOTSTRAP_ORGANIZATION_CODE').toUpperCase();
  const organizationName = required('BOOTSTRAP_ORGANIZATION_NAME');
  const adminEmail = required('BOOTSTRAP_ADMIN_EMAIL').toLowerCase();
  const adminPassword = required('BOOTSTRAP_ADMIN_PASSWORD');
  if (adminPassword.length < 12) throw new Error('BOOTSTRAP_ADMIN_PASSWORD phải có ít nhất 12 ký tự');

  const organization = await prisma.organization.upsert({
    where: { code: organizationCode },
    update: { name: organizationName },
    create: { code: organizationCode, name: organizationName },
  });
  const ownerRole = await prisma.role.upsert({
    where: { organizationId_code: { organizationId: organization.id, code: 'OWNER' } },
    update: { name: 'Chủ doanh nghiệp', permissions: ['*'] },
    create: { organizationId: organization.id, code: 'OWNER', name: 'Chủ doanh nghiệp', permissions: ['*'] },
  });
  const existingAdmin = await prisma.user.findUnique({ where: { organizationId_email: { organizationId: organization.id, email: adminEmail } } });
  const admin = existingAdmin ?? await prisma.user.create({ data: { organizationId: organization.id, email: adminEmail, displayName: 'Chủ doanh nghiệp', passwordHash: await hashPassword(adminPassword) } });
  await prisma.userRoleAssignment.upsert({
    where: { id: `${admin.id}-${ownerRole.id}` },
    update: {},
    create: { id: `${admin.id}-${ownerRole.id}`, userId: admin.id, roleId: ownerRole.id, scopeType: 'ORGANIZATION', scopeId: organization.id },
  });

  const roles = [
    { code: 'ONLINE_MANAGER', name: 'Quản lý bán hàng online', permissions: ['dashboard.read', 'organization.read', 'catalog.read', 'catalog.create', 'catalog.manage', 'inventory.read', 'sales.read', 'sales.create', 'sales.cancel', 'reports.sales', 'conversations.read', 'conversations.reply', 'conversations.close_sale', 'customers.read', 'channels.read', 'channels.manage', 'channels.sync', 'after_sales.read', 'after_sales.manage', 'purchasing.read', 'fulfillment.read', 'reconciliation.read', 'reconciliation.sync', 'alerts.read', 'alerts.manage'] },
    { code: 'CATALOG_MANAGER', name: 'Nhân viên sản phẩm', permissions: ['dashboard.read', 'catalog.read', 'catalog.create', 'catalog.manage', 'inventory.read', 'channels.read'] },
    { code: 'WAREHOUSE_STAFF', name: 'Nhân viên kho', permissions: ['dashboard.read', 'catalog.read', 'inventory.read', 'inventory.initialize', 'inventory.receive', 'inventory.adjust', 'inventory.count', 'inventory.inspect_returns', 'sales.read', 'after_sales.read', 'after_sales.receive', 'purchasing.read', 'purchasing.receive', 'fulfillment.read', 'fulfillment.dispatch', 'alerts.read', 'alerts.manage'] },
    { code: 'CUSTOMER_SERVICE', name: 'Nhân viên chăm sóc khách hàng', permissions: ['dashboard.read', 'sales.read', 'reports.sales', 'conversations.read', 'conversations.reply', 'conversations.close_sale', 'customers.read', 'after_sales.read', 'after_sales.manage'] },
    { code: 'SALES_STAFF', name: 'Nhân viên bán hàng', permissions: ['dashboard.read', 'catalog.read', 'inventory.read', 'sales.read', 'sales.create'] },
    { code: 'REPORT_VIEWER', name: 'Nhân viên báo cáo', permissions: ['dashboard.read', 'organization.read', 'inventory.read', 'sales.read', 'reports.sales', 'reconciliation.read', 'activity.read', 'alerts.read'] },
    { code: 'PURCHASING_STAFF', name: 'Nhân viên mua hàng', permissions: ['dashboard.read', 'catalog.read', 'inventory.read', 'purchasing.read', 'purchasing.manage'] },
  ];
  for (const role of roles) await prisma.role.upsert({ where: { organizationId_code: { organizationId: organization.id, code: role.code } }, update: { name: role.name, permissions: role.permissions }, create: { organizationId: organization.id, ...role } });

  const channels: Array<[string, string, ChannelType]> = [
    ['TIKTOK_01', 'TikTok Seller 01', ChannelType.TIKTOK_SHOP], ['TIKTOK_02', 'TikTok Seller 02', ChannelType.TIKTOK_SHOP], ['TIKTOK_03', 'TikTok Seller 03', ChannelType.TIKTOK_SHOP],
    ['SHOPEE_01', 'Shopee Seller 01', ChannelType.SHOPEE], ['SHOPEE_02', 'Shopee Seller 02', ChannelType.SHOPEE], ['SHOPEE_03', 'Shopee Seller 03', ChannelType.SHOPEE],
    ['FACEBOOK_01', 'Facebook Page chính', ChannelType.FACEBOOK_MESSENGER], ['POS_01', 'Cửa hàng trung tâm', ChannelType.OFFLINE_STORE],
  ];
  for (const [code, name, type] of channels) await prisma.salesChannelAccount.upsert({ where: { organizationId_code: { organizationId: organization.id, code } }, update: { name, type }, create: { organizationId: organization.id, code, name, type } });
  const branch = await prisma.branch.upsert({ where: { organizationId_code: { organizationId: organization.id, code: 'HQ' } }, update: { name: 'Chi nhánh trung tâm' }, create: { organizationId: organization.id, code: 'HQ', name: 'Chi nhánh trung tâm' } });
  await prisma.warehouse.upsert({ where: { branchId_code: { branchId: branch.id, code: 'ONLINE' } }, update: { name: 'Kho bán hàng online' }, create: { branchId: branch.id, code: 'ONLINE', name: 'Kho bán hàng online' } });
  console.log(`Production bootstrap ready for ${organizationName} (${adminEmail}).`);
}

main().finally(() => prisma.$disconnect());
