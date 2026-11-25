#!/usr/bin/env bash
set -euo pipefail

PUBLIC_URL="${1:-}"
ORGANIZATION_NAME="${2:-QL Seller}"
ADMIN_EMAIL="${3:-phamduykhanh911@gmail.com}"
OUTPUT_FILE="${4:-.env.production}"

if [[ ! "$PUBLIC_URL" =~ ^https?://[^[:space:]]+$ ]]; then
  echo "Cach dung: $0 http://IP_MAY_CHU [TEN_DOANH_NGHIEP] [EMAIL_QUAN_TRI] [TEP_DICH]" >&2
  exit 1
fi
if [[ ! "$ADMIN_EMAIL" =~ ^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$ ]]; then
  echo "Email quan tri khong hop le." >&2
  exit 1
fi
if [[ -e "$OUTPUT_FILE" ]]; then
  echo "Tep $OUTPUT_FILE da ton tai; khong ghi de khoa bao mat hien co." >&2
  exit 1
fi
if ! command -v openssl >/dev/null 2>&1; then
  echo "May chu chua co openssl." >&2
  exit 1
fi

secure_value() {
  openssl rand -base64 "$1" | tr -d '\n=' | tr '+/' '-_'
}

umask 077
cat >"$OUTPUT_FILE" <<EOF
PUBLIC_URL=${PUBLIC_URL%/}
POSTGRES_DB=enterprise_management
POSTGRES_USER=erp
POSTGRES_PASSWORD=$(secure_value 36)
JWT_SECRET=$(secure_value 64)
CHANNEL_CREDENTIAL_KEY=$(secure_value 64)
BOOTSTRAP_ORGANIZATION_NAME=$ORGANIZATION_NAME
BOOTSTRAP_ORGANIZATION_CODE=QLSELLER
BOOTSTRAP_ADMIN_EMAIL=${ADMIN_EMAIL,,}
BOOTSTRAP_ADMIN_PASSWORD=$(secure_value 24)
EOF

echo "Da tao $OUTPUT_FILE voi quyen chi chu so huu duoc doc."
echo "Hay sao luu tep nay an toan; khong commit hoac gui qua chat."
