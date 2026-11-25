FROM node:22-alpine AS build
RUN apk add --no-cache openssl
RUN corepack enable
WORKDIR /app
COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm --filter @erp/api prisma:generate && pnpm --filter @erp/api build

FROM node:22-alpine AS runtime
RUN apk add --no-cache openssl
RUN corepack enable
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app /app
EXPOSE 4000
CMD ["pnpm", "--filter", "@erp/api", "start"]
