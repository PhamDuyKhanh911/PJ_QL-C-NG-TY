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

  const defaultRoles = [
    { code: 'ONLINE_MANAGER', name: 'Quản lý bán hàng online', permissions: ['organization.read', 'catalog.read', 'catalog.create', 'catalog.manage', 'inventory.read', 'sales.read', 'sales.create', 'sales.cancel', 'reports.sales', 'conversations.read', 'conversations.reply', 'conversations.close_sale', 'customers.read', 'channels.read', 'channels.sync', 'after_sales.read', 'after_sales.manage', 'purchasing.read', 'fulfillment.read', 'reconciliation.read', 'reconciliation.sync'] },
    { code: 'CATALOG_MANAGER', name: 'Nhân viên sản phẩm', permissions: ['catalog.read', 'catalog.create', 'catalog.manage', 'inventory.read', 'channels.read'] },
    { code: 'WAREHOUSE_STAFF', name: 'Nhân viên kho', permissions: ['catalog.read', 'inventory.read', 'inventory.adjust', 'inventory.inspect_returns', 'sales.read', 'after_sales.read', 'after_sales.receive', 'purchasing.read', 'purchasing.receive', 'fulfillment.read', 'fulfillment.dispatch'] },
    { code: 'CUSTOMER_SERVICE', name: 'Nhân viên chăm sóc khách hàng', permissions: ['sales.read', 'reports.sales', 'conversations.read', 'conversations.reply', 'conversations.close_sale', 'customers.read', 'after_sales.read', 'after_sales.manage'] },
    { code: 'SALES_STAFF', name: 'Nhân viên bán hàng', permissions: ['catalog.read', 'inventory.read', 'sales.read', 'sales.create'] },
    { code: 'REPORT_VIEWER', name: 'Nhân viên báo cáo', permissions: ['organization.read', 'inventory.read', 'sales.read', 'reports.sales', 'reconciliation.read'] },
    { code: 'PURCHASING_STAFF', name: 'Nhân viên mua hàng', permissions: ['catalog.read', 'inventory.read', 'purchasing.read', 'purchasing.manage'] },
  ];
  const seededRoles = new Map<string, { id: string }>();
  for (const item of defaultRoles) {
    const seededRole = await prisma.role.upsert({
      where: { organizationId_code: { organizationId: organization.id, code: item.code } },
      update: { name: item.name, permissions: item.permissions },
      create: { organizationId: organization.id, ...item },
    });
    seededRoles.set(item.code, seededRole);
  }
  const sampleUsers = [
    { email: 'online@local.test', name: 'Nguyễn Minh Online', role: 'ONLINE_MANAGER' },
    { email: 'warehouse@local.test', name: 'Trần Nhân Kho', role: 'WAREHOUSE_STAFF' },
    { email: 'support@local.test', name: 'Lê Chăm Sóc', role: 'CUSTOMER_SERVICE' },
  ];
  for (const item of sampleUsers) {
    const sampleUser = await prisma.user.upsert({
      where: { organizationId_email: { organizationId: organization.id, email: item.email } },
      update: { displayName: item.name },
      create: { organizationId: organization.id, email: item.email, displayName: item.name, passwordHash: await hashPassword('Employee@123') },
    });
    const assignedRole = seededRoles.get(item.role)!;
    await prisma.userRoleAssignment.upsert({
      where: { id: `${sampleUser.id}-${assignedRole.id}` },
      update: {},
      create: { id: `${sampleUser.id}-${assignedRole.id}`, userId: sampleUser.id, roleId: assignedRole.id, scopeType: 'ORGANIZATION', scopeId: organization.id },
    });
  }
  const channels: Array<[string, string, ChannelType]> = [
    ['TIKTOK_01', 'TikTok Seller 01', ChannelType.TIKTOK_SHOP],
    ['TIKTOK_02', 'TikTok Seller 02', ChannelType.TIKTOK_SHOP],
    ['TIKTOK_03', 'TikTok Seller 03', ChannelType.TIKTOK_SHOP],
    ['SHOPEE_01', 'Shopee Seller 01', ChannelType.SHOPEE],
    ['SHOPEE_02', 'Shopee Seller 02', ChannelType.SHOPEE],
    ['SHOPEE_03', 'Shopee Seller 03', ChannelType.SHOPEE],
    ['POS_01', 'Cửa hàng trung tâm', ChannelType.OFFLINE_STORE],
    ['FACEBOOK_01', 'Facebook Page chính', ChannelType.FACEBOOK_MESSENGER],
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
  await prisma.supplier.upsert({
    where: { organizationId_code: { organizationId: organization.id, code: 'NCC-DEMO' } },
    update: { name: 'Nhà cung cấp Demo', phone: '0900000000' },
    create: { organizationId: organization.id, code: 'NCC-DEMO', name: 'Nhà cung cấp Demo', phone: '0900000000', email: 'supplier@example.test' },
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

  const seededChannels = await prisma.salesChannelAccount.findMany({ where: { organizationId: organization.id } });
  const seededVariants = await prisma.productVariant.findMany({ where: { sku: { in: sampleProducts.map((item) => item.sku) } } });
  const channelByCode = new Map(seededChannels.map((item) => [item.code, item]));
  const variantBySku = new Map(seededVariants.map((item) => [item.sku, item]));
  for (const channel of seededChannels.filter((item) => [ChannelType.TIKTOK_SHOP, ChannelType.SHOPEE].includes(item.type))) {
    for (const variant of seededVariants) {
      await prisma.channelSkuMapping.upsert({
        where: { channelAccountId_externalSkuId: { channelAccountId: channel.id, externalSkuId: `${channel.code}-${variant.sku}` } },
        update: { externalSku: variant.sku },
        create: { channelAccountId: channel.id, variantId: variant.id, externalProductId: `${channel.code}-PRODUCT-${variant.productId}`, externalSkuId: `${channel.code}-${variant.sku}`, externalSku: variant.sku },
      });
    }
  }
  const sampleOrders = [
    { number: 'DEMO-1001', channel: 'TIKTOK_01', sku: 'AT-BASIC-DEN-M', status: 'DELIVERED', days: 1 },
    { number: 'DEMO-1002', channel: 'SHOPEE_01', sku: 'AT-BASIC-TRANG-L', status: 'DELIVERED', days: 2 },
    { number: 'DEMO-1003', channel: 'TIKTOK_03', sku: 'QJ-SLIM-XANH-30', status: 'CANCELLED', days: 3 },
    { number: 'DEMO-1004', channel: 'SHOPEE_03', sku: 'TDC-DEN-01', status: 'RETURNED', days: 4 },
    { number: 'DEMO-1005', channel: 'POS_01', sku: 'AT-BASIC-TRANG-L', status: 'DELIVERED', days: 0 },
    { number: 'DEMO-1006', channel: 'TIKTOK_02', sku: 'TDC-DEN-01', status: 'CONFIRMED', days: 0 },
  ] as const;

  for (const item of sampleOrders) {
    const existing = await prisma.salesOrder.findUnique({ where: { orderNumber: item.number } });
    if (existing) continue;
    const channel = channelByCode.get(item.channel)!;
    const variant = variantBySku.get(item.sku)!;
    await prisma.salesOrder.create({
      data: {
        orderNumber: item.number,
        channelAccountId: channel.id,
        warehouseId: warehouse.id,
        status: item.status,
        subtotal: variant.salePrice,
        total: variant.salePrice,
        orderedAt: new Date(Date.now() - item.days * 86_400_000),
        items: { create: { variantId: variant.id, quantity: 1, unitPrice: variant.salePrice } },
        ...(item.status === 'CANCELLED' ? { afterSales: { create: { type: 'CANCELLATION', reasonCode: 'CUSTOMER_CHANGED_MIND', responsibleParty: 'CUSTOMER', status: 'COMPLETED' } } } : {}),
        ...(item.status === 'RETURNED' ? { afterSales: { create: { type: 'RETURN', reasonCode: 'SIZE_NOT_FIT', responsibleParty: 'CUSTOMER', status: 'COMPLETED' } } } : {}),
      },
    });
  }

  const chatFixtures = [
    { channel: 'TIKTOK_01', buyer: 'tt-buyer-001', name: 'Minh Anh', status: 'UNREPLIED', inbound: 'Shop ơi áo này còn size M không?' },
    { channel: 'TIKTOK_02', buyer: 'tt-buyer-002', name: 'Thu Hà', status: 'UNREAD', inbound: 'Đơn của mình khi nào được giao vậy shop?' },
    { channel: 'TIKTOK_03', buyer: 'tt-buyer-003', name: 'Quang Huy', status: 'OPEN', inbound: 'Mình muốn đổi sang màu đen.' },
    { channel: 'SHOPEE_01', buyer: 'sp-buyer-001', name: 'Ngọc Linh', status: 'UNREPLIED', inbound: 'Sản phẩm có được kiểm tra trước khi nhận không?' },
    { channel: 'SHOPEE_02', buyer: 'sp-buyer-002', name: 'Hoàng Nam', status: 'REPLIED', inbound: 'Cảm ơn shop, mình đã nhận được hàng.' },
    { channel: 'SHOPEE_03', buyer: 'sp-buyer-003', name: 'Mai Phương', status: 'UNREAD', inbound: 'Shop hỗ trợ mình đổi size nhé.' },
    { channel: 'FACEBOOK_01', buyer: 'fb-psid-001', name: 'Bảo Trâm', status: 'UNREPLIED', inbound: 'Mẫu túi này còn hàng không ạ?' },
  ];
  const allChannels = await prisma.salesChannelAccount.findMany({ where: { organizationId: organization.id } });
  const allChannelByCode = new Map(allChannels.map((item) => [item.code, item]));
  for (const [index, fixture] of chatFixtures.entries()) {
    const channel = allChannelByCode.get(fixture.channel)!;
    let identity = await prisma.customerIdentity.findUnique({ where: { channelAccountId_externalBuyerId: { channelAccountId: channel.id, externalBuyerId: fixture.buyer } } });
    if (!identity) {
      const customer = await prisma.customer.create({ data: { organizationId: organization.id, displayName: fixture.name } });
      identity = await prisma.customerIdentity.create({ data: { customerId: customer.id, channelAccountId: channel.id, externalBuyerId: fixture.buyer, displayName: fixture.name } });
    }
    const sentAt = new Date(Date.now() - index * 420_000);
    const conversation = await prisma.conversation.upsert({
      where: { channelAccountId_externalId: { channelAccountId: channel.id, externalId: `demo-conversation-${fixture.buyer}` } },
      update: { status: fixture.status, lastMessageAt: sentAt },
      create: { channelAccountId: channel.id, customerIdentityId: identity.id, externalId: `demo-conversation-${fixture.buyer}`, status: fixture.status, lastMessageAt: sentAt },
    });
    await prisma.message.upsert({
      where: { conversationId_externalId: { conversationId: conversation.id, externalId: `demo-message-${fixture.buyer}` } },
      update: { content: fixture.inbound, sentAt },
      create: { conversationId: conversation.id, externalId: `demo-message-${fixture.buyer}`, direction: 'INBOUND', type: 'TEXT', content: fixture.inbound, senderRole: 'CUSTOMER', sentAt },
    });
  }
}

main().finally(() => prisma.$disconnect());
