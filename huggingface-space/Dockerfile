# Hugging Face Space: Klassic Field Attendance API
#
# This Space intentionally holds no application source. The build clones the
# GitHub repo so the backend keeps a single source of truth -- a rebuild picks
# up the latest `main` rather than drifting from a duplicated copy.
#
# Mirrors backend/Dockerfile, with two changes forced by the platform:
#   * PORT is pinned to 7860, the port Hugging Face routes to (app_port in
#     README.md must match).
#   * the runtime user is `node` (uid 1000), which is the uid Hugging Face runs
#     containers as. The alpine node image already provides it.

FROM node:22-alpine AS builder

# bcrypt is a native addon. It installs through
# `node-pre-gyp install --fallback-to-build`, which compiles from source when no
# prebuild matches the platform -- and the musl prebuild is often absent. A bare
# node:alpine image ships no compiler, so without these the install dies with
# "gyp ERR! find Python". git is needed for the clone below.
RUN apk add --no-cache git python3 make g++

WORKDIR /src
RUN git clone --depth 1 \
      https://github.com/HYT-Foundation-Inc-Tech-Interns/KSI-AttendanceGeofencingandBiometrics-.git .

WORKDIR /src/backend

# npm ci (not install) so the build matches package-lock.json exactly.
RUN npm ci

RUN npm run build

# Drop devDependencies here rather than re-installing in the runtime stage, so
# bcrypt is compiled exactly once and the runtime image needs no toolchain.
RUN npm prune --omit=dev && npm cache clean --force

FROM node:22-alpine AS production

WORKDIR /app

ENV NODE_ENV=production

# Hugging Face routes to this port. Must match `app_port` in README.md.
ENV PORT=7860

# Reuse the pruned, already-built dependency tree. No compiler, no npm ci.
COPY --from=builder /src/backend/node_modules ./node_modules
COPY --from=builder /src/backend/dist ./dist
COPY --from=builder /src/backend/package.json ./package.json

# Hugging Face runs the container as uid 1000, and node:alpine already ships a
# `node` user at exactly that uid, so no new user has to be created.
USER node

EXPOSE 7860

# The app reads PORT at runtime and binds 0.0.0.0, so no host is hardcoded.
CMD ["node", "dist/main.js"]
