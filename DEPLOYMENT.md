# Triển khai production

Hệ thống được đóng gói cho Linux VPS bằng Docker Compose. Bộ production gồm PostgreSQL, Redis, API NestJS, Web Next.js và Nginx reverse proxy. PostgreSQL và Redis chỉ nằm trong mạng nội bộ Docker; cổng công khai duy nhất là HTTP `80`.

## 1. Chuẩn bị máy chủ

- Ubuntu 22.04/24.04 hoặc Linux tương đương.
- Docker Engine và Docker Compose plugin.
- Tối thiểu 2 CPU, 4 GB RAM và 30 GB SSD.
- Trỏ tên miền về IP máy chủ. Nên đặt HTTPS phía trước bằng Cloudflare hoặc reverse proxy TLS của nhà cung cấp.

## 2. Sinh cấu hình bí mật

Trên máy quản trị, tại thư mục dự án:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\prepare-production.ps1 `
  -PublicUrl https://erp.tenmien-cua-ban.vn `
  -OrganizationName "Tên doanh nghiệp" `
  -OrganizationCode COMPANY `
  -AdminEmail phamduykhanh911@gmail.com
```

Lệnh tạo `.env.production` với mật khẩu PostgreSQL, JWT, khóa mã hóa credential và mật khẩu quản trị ngẫu nhiên. Tệp này bị Git bỏ qua. Sao lưu tệp vào kho bí mật; không gửi qua chat và không commit.

Kiểm tra trước khi triển khai:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\check-production-readiness.ps1
```

## 3. Khởi động production

Sao chép repository và `.env.production` lên VPS, sau đó chạy:

```bash
docker compose --env-file .env.production -f docker-compose.production.yml up -d --build
docker compose --env-file .env.production -f docker-compose.production.yml ps
curl http://127.0.0.1/api/health
```

Mỗi lần API khởi động, migration được áp dụng tự động. Bootstrap production chỉ tạo dữ liệu nền nếu chưa có: tài khoản chủ doanh nghiệp, vai trò chuẩn, chi nhánh, kho, 3 TikTok Seller, 3 Shopee Seller, Facebook Page và cửa hàng offline. Bootstrap không tạo sản phẩm, đơn hàng hay hội thoại demo và không đổi mật khẩu của tài khoản quản trị đã tồn tại.

## 4. Kết nối các kênh thật

Đăng nhập bằng email quản trị và mật khẩu trong `.env.production`, mở `/channels`, rồi cấu hình từng gian hàng.

| Kênh | Thông tin cần chuẩn bị |
| --- | --- |
| TikTok Seller 01–03 | Service ID/Authorization URL, App Key, App Secret, OAuth của đúng shop, kho mặc định |
| Shopee Seller 01–03 | Partner ID, Partner Key, Shop ID, OAuth của đúng shop, kho mặc định |
| Facebook Page | App ID, App Secret, Page ID, Page Access Token, Webhook Secret |

Webhook hiển thị ngay trên màn hình cấu hình kênh. Khai báo đúng URL đó tại cổng nhà phát triển của TikTok, Shopee hoặc Meta. Sau khi lưu, bấm **Kiểm tra kết nối**; chỉ bật đồng bộ đơn/tồn/chat khi trạng thái kênh là `READY`.

Credential được mã hóa trước khi lưu PostgreSQL bằng `CHANNEL_CREDENTIAL_KEY`. Không thay đổi hoặc làm mất khóa này sau khi đã kết nối kênh, nếu không token đã lưu sẽ không thể giải mã.

## 5. Sao lưu và cập nhật

Trước mỗi lần cập nhật, tạo bản sao lưu tại `/backups`. Cập nhật mã nguồn và chạy lại:

```bash
git pull origin main
docker compose --env-file .env.production -f docker-compose.production.yml up -d --build
```

Kiểm tra log khi cần:

```bash
docker compose --env-file .env.production -f docker-compose.production.yml logs -f api web proxy
```
