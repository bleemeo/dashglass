# Stage 1: build the SPA (workspace packages are consumed as TS source,
# so the whole monorepo is needed for the app build).
FROM node:24-alpine AS web-builder
WORKDIR /src
# Install the exact pnpm version pinned in package.json (packageManager):
# any other version tries to self-download the pinned one, which fails in
# the --offline install below.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN npm install -g "pnpm@$(node -p "require('./package.json').packageManager.split('@')[1].split('+')[0]")"
# Fetch dependencies from the lockfile alone so this layer is cached
# across source-only changes.
RUN pnpm fetch
COPY . .
RUN pnpm install --frozen-lockfile --offline
RUN pnpm --filter dashglass build

# Stage 2: build the Go binary with the SPA embedded.
FROM golang:1.26-alpine AS go-builder
ARG VERSION=dev
WORKDIR /src/backend
COPY backend/go.mod backend/go.sum ./
RUN go mod download
COPY backend/ ./
# Replace the tracked placeholder with the real build output.
RUN rm -rf internal/ui/dist
COPY --from=web-builder /src/apps/dashglass/dist internal/ui/dist
RUN CGO_ENABLED=0 go build -trimpath -ldflags="-s -w -X main.version=${VERSION}" -o /dashglass .

# Stage 3: minimal runtime image. git + ssh power the dashboard history
# and remote sync features (absent binaries just disable them).
FROM alpine:3.22
RUN apk add --no-cache git openssh-client
RUN adduser -D -H -u 1000 dashglass
COPY --from=go-builder /dashglass /usr/local/bin/dashglass
# /data holds server-managed state (auth.yaml); owned by the non-root user
# and its own volume so it persists and stays writable.
RUN mkdir -p /data && chown dashglass /data
USER dashglass
EXPOSE 8080
VOLUME /dashboards
VOLUME /data
ENV DASHGLASS_AUTH_FILE=/data/auth.yaml
ENTRYPOINT ["dashglass", "-dashboards-dir", "/dashboards"]
