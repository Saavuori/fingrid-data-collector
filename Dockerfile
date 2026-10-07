# syntax=docker/dockerfile:1

# Stage 1: Build the React frontend
FROM --platform=$BUILDPLATFORM node:26-alpine AS frontend-builder
WORKDIR /app/frontend
COPY frontend/package*.json ./
RUN npm ci
COPY frontend/ ./
# Both UIs: the collector's (dist/) and the public viewer's (dist-viewer/).
RUN npm run build && npm run build:viewer

# Stage 2: Cross-compile the Rust backend using tonistiigi/xx
FROM --platform=$BUILDPLATFORM tonistiigi/xx AS xx

FROM --platform=$BUILDPLATFORM rust:alpine AS backend-builder
RUN apk add --no-cache clang lld musl-dev git file
COPY --from=xx / /

ARG TARGETPLATFORM
ARG VERSION="unknown"
WORKDIR /app

RUN xx-apk add --no-cache musl-dev

# Copy Cargo files first
COPY backend/Cargo.toml backend/Cargo.lock ./
COPY backend/src ./src

RUN mkdir -p /out

RUN VERSION=${VERSION} xx-cargo build --release --target-dir /target && \
    for bin in fingrid-collector fingrid-viewer; do \
      cp /target/$(xx-cargo --print-target-triple)/release/$bin /out/$bin && \
      xx-verify /out/$bin; \
    done

# Stage 3a: the public read-only dashboard (FingridFlow Live).
# Build with `--target viewer`. Needs FINGRID_API_KEY (or FINGRID_API_KEY_FILE).
FROM alpine:latest AS viewer
RUN apk add --no-cache ca-certificates tzdata
WORKDIR /app
COPY --from=backend-builder /out/fingrid-viewer .
COPY --from=frontend-builder /app/frontend/dist-viewer ./dist
# Nothing is written to disk, so it runs unprivileged (and works read-only).
USER 65534:65534
EXPOSE 3000
HEALTHCHECK --interval=60s --timeout=5s --start-period=20s \
  CMD wget -qO- http://127.0.0.1:3000/api/health >/dev/null || exit 1
CMD ["./fingrid-viewer"]

# Stage 3b: the collector — the default target, as before.
FROM alpine:latest AS collector
RUN apk add --no-cache ca-certificates tzdata
WORKDIR /app
COPY --from=backend-builder /out/fingrid-collector .
COPY --from=frontend-builder /app/frontend/dist ./dist

EXPOSE 3000
CMD ["./fingrid-collector"]
