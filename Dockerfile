# ── Build stage ───────────────────────────────────────────────────────────────
FROM node:20-alpine AS builder
WORKDIR /app

COPY package*.json ./
RUN npm ci --ignore-scripts

COPY tsconfig.json ./
COPY src/ ./src/

RUN npm run build

# ── Production stage ──────────────────────────────────────────────────────────
FROM node:20-alpine AS production
WORKDIR /app

# Security: run as non-root
RUN addgroup -g 1001 -S cybertip && \
    adduser -S -u 1001 -G cybertip cybertip

# Install only production deps
COPY package*.json ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force

# Copy built app
COPY --from=builder /app/dist ./dist
COPY dashboard/ ./dashboard/

# Health check binary
RUN apk add --no-cache curl

USER cybertip
EXPOSE 3000

ENV NODE_ENV=production
CMD ["node", "dist/index.js"]
