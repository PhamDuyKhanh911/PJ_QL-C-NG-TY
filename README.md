# Hệ thống Quản lý Doanh nghiệp Đa kênh

Nền tảng quản lý tập trung bán hàng online/offline, tồn kho, đơn hàng, CRM và chăm sóc khách hàng cho nhiều gian hàng TikTok Shop, Shopee và cửa hàng vật lý.

## Kiến trúc

- `apps/web`: giao diện quản trị Next.js.
- `apps/api`: API NestJS và mô hình dữ liệu Prisma/PostgreSQL.
- PostgreSQL: dữ liệu nghiệp vụ và sổ giao dịch tồn kho.
- Redis: hàng đợi đồng bộ kênh, webhook và thông báo.

Hệ thống được tổ chức theo modular monolith để dễ triển khai ban đầu nhưng vẫn tách rõ các miền: Identity, Organization, Catalog, Inventory, Sales, Channels, CRM và Customer Service.

## Khởi động local

Yêu cầu Node.js 22+, pnpm 10+ và Docker Desktop.

```bash
copy .env.example .env
docker compose up -d
pnpm install
pnpm db:generate
pnpm db:migrate
pnpm --filter @erp/api prisma:seed
pnpm dev
```

- Web: http://localhost:3000
- API: http://localhost:4000/api
- Health check: http://localhost:4000/api/health

### Tài khoản phát triển

Sau khi chạy seed:

- Email: `admin@local.test`
- Mật khẩu mặc định: giá trị `SEED_ADMIN_PASSWORD` trong `.env`

Đổi mật khẩu seed và `JWT_SECRET` trước khi dùng trên môi trường thật.

### API xác thực đầu tiên

- `POST /api/auth/login`: đăng nhập bằng email/mật khẩu.
- `GET /api/auth/me`: hồ sơ, quyền và phạm vi của tài khoản hiện tại.
- `GET /api/organization/overview`: tổng quan tổ chức; yêu cầu quyền `organization.read` hoặc `*`.

## Nguyên tắc nghiệp vụ

- Mỗi Seller/cửa hàng là một `SalesChannelAccount` độc lập.
- Tồn kho thay đổi qua `InventoryTransaction`, không sửa trực tiếp mà không có nhật ký.
- Tồn có thể bán = tồn thực tế - giữ chỗ - cách ly - tồn an toàn.
- Quyền truy cập kết hợp vai trò, hành động và phạm vi dữ liệu.
- Hủy, hoàn và đổi trả lưu riêng nguyên nhân và bên chịu trách nhiệm.
- Mọi webhook phải chống xử lý trùng bằng mã sự kiện ngoài hệ thống.
