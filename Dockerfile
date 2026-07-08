# Stage 1: build the SPA (workspace packages are consumed as TS source,
# so the whole monorepo is needed for the app build).
FROM node:24-alpine AS web-builder
RUN npm install -g pnpm@11
WORKDIR /src
# Fetch dependencies from the lockfile alone so this layer is cached
# across source-only changes.
COPY pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm fetch
COPY . .
RUN pnpm install --frozen-lockfile --offline
RUN pnpm --filter polaris build

# Stage 2: build the Go binary with the SPA embedded.
FROM golang:1.26-alpine AS go-builder
WORKDIR /src/backend
COPY backend/go.mod backend/go.sum ./
RUN go mod download
COPY backend/ ./
# Replace the tracked placeholder with the real build output.
RUN rm -rf internal/ui/dist
COPY --from=web-builder /src/apps/polaris/dist internal/ui/dist
RUN CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /polaris .

# Stage 3: minimal runtime image. git + ssh power the dashboard history
# and remote sync features (absent binaries just disable them).
FROM alpine:3.22
RUN apk add --no-cache git openssh-client
RUN adduser -D -H -u 1000 polaris
COPY --from=go-builder /polaris /usr/local/bin/polaris
# /data holds server-managed state (auth.yaml); owned by the non-root user
# and its own volume so it persists and stays writable.
RUN mkdir -p /data && chown polaris /data
USER polaris
EXPOSE 8080
VOLUME /dashboards
VOLUME /data
ENV POLARIS_AUTH_FILE=/data/auth.yaml
ENTRYPOINT ["polaris", "-dashboards-dir", "/dashboards"]
