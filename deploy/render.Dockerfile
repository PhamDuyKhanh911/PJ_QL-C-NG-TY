FROM node:22-alpine AS build

RUN apk add --no-cache openssl
RUN corepack enable
WORKDIR /app

ENV NEXT_PUBLIC_API_URL=/api
COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm --filter @erp/api prisma:generate
RUN pnpm --filter @erp/api build
RUN pnpm --filter @erp/web build

FROM node:22-alpine AS runtime

RUN apk add --no-cache openssl curl
RUN corepack enable
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

COPY --from=build /app /app
RUN chmod +x /app/deploy/render-start.sh

EXPOSE 10000
CMD ["/app/deploy/render-start.sh"]
