# Stage 1: Build
#
# Node 22 rather than 18: Node 18 went end-of-life in April 2025 and Node 20 in
# April 2026, so both are unsupported and receive no security patches. Node 22
# is the current LTS and matches NODE_VERSION=22 on the dashboard build.
FROM node:22-alpine AS builder

WORKDIR /app

# Build toolchain.
#
# bcrypt is a native addon. It installs through `node-pre-gyp install
# --fallback-to-build`, which downloads a prebuilt binary when one matches the
# platform and otherwise compiles from source. On musl (Alpine) the prebuild is
# often absent, and a plain node:alpine image ships no compiler, so the fallback
# dies with "gyp ERR! find Python". These three packages are what the fallback
# needs. Without them the image only builds on machines that happen to have a
# matching prebuild -- which is a silent, platform-dependent failure.
RUN apk add --no-cache python3 make g++

# Copy package files
COPY package*.json ./
COPY tsconfig.json ./
COPY nest-cli.json ./

# Install dependencies
RUN npm ci

# Copy source code
COPY src ./src

# Build the application
RUN npm run build

# Drop devDependencies, keeping the already-compiled native addons.
#
# Doing the prune here instead of a second `npm ci --only=production` in the
# runtime stage means bcrypt is compiled exactly once and the runtime image
# needs no toolchain at all. `--only=production` is also the npm 6 spelling;
# `--omit=dev` is the current one.
RUN npm prune --omit=dev && npm cache clean --force

# Stage 2: Production
FROM node:22-alpine AS production

WORKDIR /app

ENV NODE_ENV=production

# Reuse the pruned, already-built dependency tree. No compiler, no npm ci.
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/package.json ./package.json

# Create a non-root user
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nestjs -u 1001
USER nestjs

# Expose port
EXPOSE 3000

# Health check.
#
# The port is read from $PORT at runtime rather than hardcoded, because the
# host assigns it: Render defaults to 10000, not 3000. A hardcoded 3000 made
# this check report the container unhealthy on any host that sets PORT.
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "require('http').get('http://localhost:'+(process.env.PORT||3000)+'/v1/health', (r) => {process.exit(r.statusCode === 200 ? 0 : 1)})"

# Start the application
CMD ["node", "dist/main.js"]
