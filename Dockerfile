# Stage 1: Dependencies
FROM node:20-alpine AS deps
# python3 + make + g++ let node-gyp build native modules when no prebuilt
# musl/x64 binary is published for the installed version.
RUN apk add --no-cache libc6-compat python3 make g++
WORKDIR /app

COPY package.json package-lock.json ./
# npm ci can hit a transient registry ECONNRESET in CI (surfaces as exit 152);
# raise the network retry count so a single reset self-heals instead of failing the build.
RUN npm ci --fetch-retries=5 --fetch-retry-maxtimeout=120000

# Stage 2: Builder
FROM node:20-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Disable Next.js telemetry during build
ENV NEXT_TELEMETRY_DISABLED=1

ARG DASHCLAW_MODE
ARG NEXT_PUBLIC_DASHCLAW_MODE
ENV DASHCLAW_MODE=${DASHCLAW_MODE}
ENV NEXT_PUBLIC_DASHCLAW_MODE=${NEXT_PUBLIC_DASHCLAW_MODE}

RUN npm run build

# Stage 3: Runner
FROM node:20-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

ARG DASHCLAW_MODE
ENV DASHCLAW_MODE=${DASHCLAW_MODE:-demo}
ENV NEXT_PUBLIC_DASHCLAW_MODE=${DASHCLAW_MODE:-demo}

RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nextjs

COPY --from=builder /app/public ./public

# Set the correct permission for prerender cache
RUN mkdir .next
RUN chown nextjs:nodejs .next

# Automatically leverage output traces to reduce image size
# https://nextjs.org/docs/advanced-features/output-file-tracing
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=builder --chown=nextjs:nodejs /app/scripts/demo-entrypoint.mjs ./scripts/demo-entrypoint.mjs
COPY --from=builder --chown=nextjs:nodejs /app/scripts/demo-agent.mjs ./scripts/demo-agent.mjs

USER nextjs

EXPOSE 3000

ENV PORT=3000
# set hostname to localhost
ENV HOSTNAME="0.0.0.0"

CMD ["node", "/app/scripts/demo-entrypoint.mjs"]
