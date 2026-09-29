# Next.js standalone output: the runtime image carries a traced subset of node_modules
# rather than the whole tree.

FROM node:22-alpine AS base
RUN apk add --no-cache libc6-compat
WORKDIR /repo

FROM base AS deps
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/web/package.json apps/web/
RUN npm ci --workspace @mk/web --workspace @mk/shared --include-workspace-root

FROM deps AS build
COPY tsconfig.base.json ./
COPY packages/shared packages/shared
COPY apps/web apps/web
# NEXT_PUBLIC_* values are inlined at build time, so they are build args, not runtime env.
ARG NEXT_PUBLIC_API_URL
ARG NEXT_PUBLIC_DEFAULT_TENANT=mithilakitchen
ARG NEXT_PUBLIC_BRAND_NAME=MithilaKitchen
ARG NEXT_PUBLIC_RAZORPAY_KEY_ID
ARG NEXT_PUBLIC_SITE_URL
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build --workspace @mk/shared && npm run build --workspace @mk/web

FROM base AS runtime
ENV NODE_ENV=production
ENV TZ=Asia/Kolkata
ENV NEXT_TELEMETRY_DISABLED=1
RUN addgroup -S mk && adduser -S mk -G mk
WORKDIR /app

COPY --from=build --chown=mk:mk /repo/apps/web/.next/standalone ./
COPY --from=build --chown=mk:mk /repo/apps/web/.next/static ./apps/web/.next/static
COPY --from=build --chown=mk:mk /repo/apps/web/public ./apps/web/public

USER mk
EXPOSE 3000
ENV PORT=3000 HOSTNAME=0.0.0.0

CMD ["node", "apps/web/server.js"]
