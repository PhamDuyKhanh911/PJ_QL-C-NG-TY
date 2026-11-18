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

  const branch = await prisma.branch.upsert({
    where: { organizationId_code: { organizationId: organization.id, code: 'HQ' } },
    update: {},
    create: { organizationId: organization.id, code: 'HQ', name: 'Chi nhánh trung tâm' },
  });
  const warehouse = await prisma.warehouse.upsert({
    where: { branchId_code: { branchId: branch.id, code: 'ONLINE' } },
    update: {},
    create: { branchId: branch.id, code: 'ONLINE', name: 'Kho bán hàng online' },
  });

  const sampleProducts = [
    { product: 'Áo thun Basic', sku: 'AT-BASIC-DEN-M', variant: 'Đen / M', cost: 85000, price: 169000, stock: 18, reorder: 20, safety: 5 },
    { product: 'Áo thun Basic', sku: 'AT-BASIC-TRANG-L', variant: 'Trắng / L', cost: 85000, price: 169000, stock: 52, reorder: 20, safety: 5 },
    { product: 'Quần jean Slim', sku: 'QJ-SLIM-XANH-30', variant: 'Xanh / 30', cost: 210000, price: 429000, stock: 9, reorder: 15, safety: 3 },
    { product: 'Túi đeo chéo', sku: 'TDC-DEN-01', variant: 'Đen', cost: 120000, price: 259000, stock: 41, reorder: 12, safety: 4 },
  ];

  for (const item of sampleProducts) {
    let product = await prisma.product.findFirst({ where: { organizationId: organization.id, name: item.product } });
    product ??= await prisma.product.create({ data: { organizationId: organization.id, name: item.product } });
    const variant = await prisma.productVariant.upsert({
      where: { sku: item.sku },
      update: { name: item.variant, costPrice: item.cost, salePrice: item.price },
      create: { productId: product.id, sku: item.sku, name: item.variant, costPrice: item.cost, salePrice: item.price },
    });
    await prisma.inventoryBalance.upsert({
      where: { warehouseId_variantId: { warehouseId: warehouse.id, variantId: variant.id } },
      update: { onHand: item.stock, reorderPoint: item.reorder, safetyStock: item.safety },
      create: { warehouseId: warehouse.id, variantId: variant.id, onHand: item.stock, reorderPoint: item.reorder, safetyStock: item.safety },
    });
  }
}

main().finally(() => prisma.$disconnect());
