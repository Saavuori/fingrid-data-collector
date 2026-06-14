# syntax=docker/dockerfile:1

# Stage 1: Build the React frontend
FROM --platform=$BUILDPLATFORM node:22-alpine AS frontend-builder
WORKDIR /app/frontend
COPY frontend/package*.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

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
    cp /target/$(xx-cargo --print-target-triple)/release/fingrid-collector /out/fingrid-collector && \
    xx-verify /out/fingrid-collector

# Stage 3: Final minimal image
FROM alpine:latest
RUN apk add --no-cache ca-certificates tzdata
WORKDIR /app
COPY --from=backend-builder /out/fingrid-collector .
COPY --from=frontend-builder /app/frontend/dist ./dist

EXPOSE 3000
CMD ["./fingrid-collector"]
