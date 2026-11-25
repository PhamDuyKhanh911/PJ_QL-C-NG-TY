#!/bin/sh
set -eu

export API_PORT="${API_PORT:-4000}"
export PORT="${PORT:-10000}"
export WEB_ORIGIN="${WEB_ORIGIN:-${RENDER_EXTERNAL_URL:-http://localhost:${PORT}}}"
export API_PUBLIC_URL="${API_PUBLIC_URL:-${RENDER_EXTERNAL_URL:-http://localhost:${PORT}}}"

pnpm --filter @erp/api exec prisma migrate deploy
pnpm --filter @erp/api prisma:bootstrap:production

NODE_OPTIONS="${API_NODE_OPTIONS:---max-old-space-size=160}" pnpm --filter @erp/api start &
api_pid=$!
NODE_OPTIONS="${WEB_NODE_OPTIONS:---max-old-space-size=224}" pnpm --filter @erp/web exec next start -H 0.0.0.0 -p "$PORT" &
web_pid=$!

shutdown() {
  kill "$api_pid" "$web_pid" 2>/dev/null || true
  wait "$api_pid" "$web_pid" 2>/dev/null || true
}
trap shutdown INT TERM EXIT

while kill -0 "$api_pid" 2>/dev/null && kill -0 "$web_pid" 2>/dev/null; do
  sleep 5
done

echo "Mot tien trinh qlseller da dung; ket thuc container de Render khoi dong lai." >&2
exit 1
