# Multi-stage so the runtime image carries no compiler, no source and no dev deps.
# Final image is ~180 MB against ~1.2 GB for a naive single-stage build — which matters
# on a 160 GB VPS that also holds Postgres, and on every deploy over a domestic uplink.

FROM node:22-alpine AS base
RUN apk add --no-cache libc6-compat openssl
WORKDIR /repo

FROM base AS deps
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
RUN npm ci --workspace @mk/api --workspace @mk/shared --include-workspace-root

FROM deps AS build
COPY tsconfig.base.json ./
COPY packages/shared packages/shared
COPY apps/api apps/api
RUN npm run build --workspace @mk/shared \
 && npx --workspace @mk/api prisma generate \
 && npm run build --workspace @mk/api

FROM base AS runtime
ENV NODE_ENV=production
ENV TZ=Asia/Kolkata
# Never run as root: a container escape should not begin with uid 0.
RUN addgroup -S mk && adduser -S mk -G mk
WORKDIR /repo

COPY --from=build /repo/node_modules ./node_modules
COPY --from=build /repo/package.json ./
COPY --from=build /repo/packages/shared/dist packages/shared/dist
COPY --from=build /repo/packages/shared/package.json packages/shared/
COPY --from=build /repo/apps/api/dist apps/api/dist
COPY --from=build /repo/apps/api/package.json apps/api/
# Migrations and the security SQL ship with the image so a deploy can apply them.
COPY --from=build /repo/apps/api/prisma apps/api/prisma
COPY --from=build /repo/apps/api/scripts apps/api/scripts

USER mk
WORKDIR /repo/apps/api
EXPOSE 4000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:4000/api/health/ready').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "dist/main.js"]
