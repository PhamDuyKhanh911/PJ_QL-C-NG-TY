#!/usr/bin/env bash
set -euo pipefail

PUBLIC_URL="${1:-}"
if [[ ! "$PUBLIC_URL" =~ ^https?://[^[:space:]]+$ ]]; then
  echo "Cach dung: $0 http://IP_MAY_CHU" >&2
  exit 1
fi

cd "$(dirname "$0")/.."
if [[ ! -f .env.production ]]; then
  ./scripts/prepare-production.sh "$PUBLIC_URL" "QL Seller" "phamduykhanh911@gmail.com"
fi

DOCKER=(docker)
if [[ "$(id -u)" -ne 0 ]] && ! docker info >/dev/null 2>&1; then
  DOCKER=(sudo docker)
fi

"${DOCKER[@]}" compose --env-file .env.production -f docker-compose.production.yml config --quiet
"${DOCKER[@]}" compose --env-file .env.production -f docker-compose.production.yml up -d --build

echo "Dang cho qlseller khoi dong..."
for _ in {1..60}; do
  if curl -fsS http://127.0.0.1/api/health >/dev/null 2>&1; then
    echo "QL Seller da hoat dong tai ${PUBLIC_URL%/}"
    "${DOCKER[@]}" compose --env-file .env.production -f docker-compose.production.yml ps
    exit 0
  fi
  sleep 5
done

echo "Ung dung chua san sang sau 5 phut. Log gan nhat:" >&2
"${DOCKER[@]}" compose --env-file .env.production -f docker-compose.production.yml logs --tail=100 api web proxy >&2
exit 1
