# Triển khai QL Seller

Hệ thống được đóng gói cho Linux VPS bằng Docker Compose. Bộ production gồm PostgreSQL, Redis, API NestJS, Web Next.js và Nginx reverse proxy. PostgreSQL và Redis chỉ nằm trong mạng nội bộ Docker; cổng công khai duy nhất là HTTP `80`.

Tên dự án Docker Compose được cố định là `qlseller`, vì vậy container, network và volume dữ liệu không bị đổi tên theo thư mục cài đặt.

## Bản kiểm thử miễn phí trên Render

Tệp `render.yaml` tạo một Web Service `qlseller` và một PostgreSQL `qlseller-db`, đều dùng gói miễn phí tại Singapore. Web Next.js chuyển tiếp `/api/*` nội bộ đến API NestJS nên chỉ tiêu thụ một Web Service và nằm trong hạn mức 750 giờ miễn phí mỗi tháng.

Tạo Blueprint từ repository GitHub rồi chờ health check `/api/health` thành công. Render tự sinh JWT, khóa mã hóa credential và mật khẩu quản trị. Đăng nhập bằng `phamduykhanh911@gmail.com`; mật khẩu ban đầu xem tại biến `BOOTSTRAP_ADMIN_PASSWORD` trong trang Environment của dịch vụ.

Đây chỉ là môi trường kiểm thử: dịch vụ ngủ sau 15 phút không có truy cập và PostgreSQL miễn phí hết hạn sau 30 ngày. Tạo sao lưu tại `/backups` trước khi cơ sở dữ liệu hết hạn hoặc chuyển `DATABASE_URL` sang PostgreSQL lâu dài.

## 1. Máy chủ miễn phí được chọn

Oracle Cloud Always Free phù hợp nhất với cấu trúc hiện tại vì cho phép chạy cả Docker Compose và lưu PostgreSQL trên ổ đĩa lâu dài. Khi tạo máy ảo, chọn Ubuntu 24.04, kiến trúc Ampere A1, cấp 2 OCPU, 12 GB RAM và mở cổng TCP `80`, `443` trong Security List/Network Security Group.

Trên máy ảo mới, cài Docker bằng script đi kèm:

```bash
git clone https://github.com/PhamDuyKhanh911/PJ_QL-C-NG-TY.git qlseller
cd qlseller
chmod +x scripts/*.sh
./scripts/provision-ubuntu.sh
```

## 2. Chuẩn bị máy chủ khác

- Ubuntu 22.04/24.04 hoặc Linux tương đương.
- Docker Engine và Docker Compose plugin.
- Tối thiểu 2 CPU, 4 GB RAM và 30 GB SSD.
- Trỏ tên miền về IP máy chủ. Nên đặt HTTPS phía trước bằng Cloudflare hoặc reverse proxy TLS của nhà cung cấp.

## 3. Sinh cấu hình bí mật

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

Trên Ubuntu có thể tạo cấu hình và triển khai gọn bằng IP công khai của máy chủ:

```bash
./scripts/deploy-qlseller.sh http://IP_MAY_CHU
```

Lệnh này tự tạo `.env.production` nếu chưa có, dựng toàn bộ dịch vụ và đợi API hoạt động. Mật khẩu quản trị ban đầu nằm trong biến `BOOTSTRAP_ADMIN_PASSWORD` của `.env.production` trên máy chủ.

## 4. Khởi động production thủ công

Sao chép repository và `.env.production` lên VPS, sau đó chạy:

```bash
docker compose --env-file .env.production -f docker-compose.production.yml up -d --build
docker compose --env-file .env.production -f docker-compose.production.yml ps
curl http://127.0.0.1/api/health
```

Mỗi lần API khởi động, migration được áp dụng tự động. Bootstrap production chỉ tạo dữ liệu nền nếu chưa có: tài khoản chủ doanh nghiệp, vai trò chuẩn, chi nhánh, kho, 3 TikTok Seller, 3 Shopee Seller, Facebook Page và cửa hàng offline. Bootstrap không tạo sản phẩm, đơn hàng hay hội thoại demo và không đổi mật khẩu của tài khoản quản trị đã tồn tại.

## 5. Kết nối các kênh thật

Đăng nhập bằng email quản trị và mật khẩu trong `.env.production`, mở `/channels`, rồi cấu hình từng gian hàng.

| Kênh | Thông tin cần chuẩn bị |
| --- | --- |
| TikTok Seller 01–03 | Service ID/Authorization URL, App Key, App Secret, OAuth của đúng shop, kho mặc định |
| Shopee Seller 01–03 | Partner ID, Partner Key, Shop ID, OAuth của đúng shop, kho mặc định |
| Facebook Page | App ID, App Secret, Page ID, Page Access Token, Webhook Secret |

Webhook hiển thị ngay trên màn hình cấu hình kênh. Khai báo đúng URL đó tại cổng nhà phát triển của TikTok, Shopee hoặc Meta. Sau khi lưu, bấm **Kiểm tra kết nối**; chỉ bật đồng bộ đơn/tồn/chat khi trạng thái kênh là `READY`.

Credential được mã hóa trước khi lưu PostgreSQL bằng `CHANNEL_CREDENTIAL_KEY`. Không thay đổi hoặc làm mất khóa này sau khi đã kết nối kênh, nếu không token đã lưu sẽ không thể giải mã.

## 6. Sao lưu và cập nhật

Trước mỗi lần cập nhật, tạo bản sao lưu tại `/backups`. Cập nhật mã nguồn và chạy lại:

```bash
git pull origin main
docker compose --env-file .env.production -f docker-compose.production.yml up -d --build
```

Kiểm tra log khi cần:

```bash
docker compose --env-file .env.production -f docker-compose.production.yml logs -f api web proxy
```
