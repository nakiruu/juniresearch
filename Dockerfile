# syntax=docker/dockerfile:1

# juniresearch render site — production image.
# Builds the statically generated Next.js report site and serves it with the
# standalone Node server. The published reports (data/*.json) are baked in at
# build time, so rebuild the image to pick up new reports. The site needs no
# secrets. The capture/synthesis pipeline is not part of this image: its capture
# steps reach Claude's MCP connectors, which do not exist inside a container.

# --- deps: install all dependencies against the lockfile ---
FROM node:24-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

# --- build: produce the standalone Next.js output ---
FROM node:24-alpine AS build
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

# --- runner: minimal image that serves the built site ---
FROM node:24-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    HOSTNAME=0.0.0.0 \
    PORT=3000
# Run as a non-root user.
RUN addgroup -g 1001 -S nodejs && adduser -u 1001 -S nextjs -G nodejs
# server.js and the traced node_modules come from the standalone bundle; the
# public assets and the client static chunks are copied in beside it, which the
# standalone server then serves directly.
COPY --from=build --chown=nextjs:nodejs /app/public ./public
COPY --from=build --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=build --chown=nextjs:nodejs /app/.next/static ./.next/static
USER nextjs
EXPOSE 3000
CMD ["node", "server.js"]

# --- trader: full app image so the container both serves the site (arming the in-process
#     scheduler via instrumentation.ts) AND runs the trade:* CLI by hand (docker exec). ---
FROM node:24-alpine AS trader
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    HOSTNAME=0.0.0.0 \
    PORT=3000
# Full dependency set (INCLUDING tsx) — the trade:* npm scripts run under `node --import tsx`.
COPY --from=deps /app/node_modules ./node_modules
# The full app: scripts/, lib/, package.json (the trade:* scripts), data/*.json reports, next build output source.
COPY . .
RUN npm run build \
 && addgroup -g 1001 -S nodejs && adduser -u 1001 -S nextjs -G nodejs \
 && mkdir -p data/trade && chown -R nextjs:nodejs /app
USER nextjs
EXPOSE 3000
CMD ["npm", "start"]
