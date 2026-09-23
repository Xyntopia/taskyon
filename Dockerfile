# syntax=docker/dockerfile:1

# Build browser-compatible Rustls before the Node build. The generated WASM is
# intentionally not committed.
FROM docker.io/library/rust:bookworm AS https-tunnel-wasm-builder
RUN rustup target add wasm32-unknown-unknown && \
    cargo install wasm-bindgen-cli \
      --version 0.2.108 \
      --locked
WORKDIR /build
COPY packages/https_tunnel_wasm/Cargo.toml \
     packages/https_tunnel_wasm/Cargo.lock ./
COPY packages/https_tunnel_wasm/src ./src
RUN cargo build \
      --target wasm32-unknown-unknown \
      --release && \
    wasm-bindgen \
      target/wasm32-unknown-unknown/release/https_tunnel_wasm.wasm \
      --target web \
      --typescript \
      --out-dir pkg

FROM docker.io/library/node:22.20.0-alpine AS build-metadata
ARG COMMIT_HASH=unknown
ARG PUBLISH_DATE=unknown
WORKDIR /metadata
COPY scripts/write-build-metadata.mjs ./
RUN node write-build-metadata.mjs \
      build-metadata.json \
      "${COMMIT_HASH}" \
      "${PUBLISH_DATE}"

# Stage 1: Build the Quasar application
FROM docker.io/library/node:22.20.0 AS prepare
# Set up Yarn cache directory
ENV YARN_CACHE_FOLDER=/tmp/.yarn-cache

# Use the exact Yarn release pinned by the repository.
ENV COREPACK_ENABLE_STRICT=1
ENV COREPACK_DEFAULT_TO_LATEST=0
RUN corepack enable && corepack prepare yarn@4.16.0 --activate


# it looks like after removing quasar postinstall we don't need this anymore??
# we don't need to bust the cache here, because it  gets thrown away due to our staged build anyways...
# Install dependencies for native modules
#RUN apt-get update && apt-get install -y \
#    python3 \
#    make \
#    g++
# for some reason, the following is needed to run yarn install...
# libcairo2-dev libjpeg-dev libgif-dev \
# libpangocairo-1.0-0 libpango1.0-dev \
# libvips-dev libjpeg-dev libpng-dev

# Set working directory
WORKDIR /app

# Copy package.json and yarn.lock first to leverage the container build cache
COPY package.json yarn.lock .yarnrc.yml /app/

# Copy all workspace manifests while preserving their relative directories.
# Yarn needs the complete workspace graph to resolve `workspace:*` references.
COPY --parents packages/*/package.json ./

RUN ls -a packages/*

# Install dependencies with cache and ignore optional dependencies
#RUN --mount=type=cache,target=$YARN_CACHE_FOLDER yarn install --frozen-lockfile --ignore-optional
RUN --mount=type=cache,target=$YARN_CACHE_FOLDER yarn install

# Copy the rest of the project files
COPY . .
COPY --from=https-tunnel-wasm-builder \
  /build/pkg \
  /app/packages/https_tunnel_wasm/pkg

FROM prepare AS production-builder

# this should build the app inside the folder /app/dist/spa
RUN yarn build:app-dependencies && \
  yarn quasar prepare && \
  yarn docs:check && \
  yarn links:check && \
  yarn pack:tyclient && \
  yarn lint && \
  TASKYON_BUILD_CHECKS_COMPLETED=1 yarn quasar build

# ───────────────────────────────────────────────────────
# build debug build
# ───────────────────────────────────────────────────────

FROM prepare AS debug-builder

RUN yarn build:app-dependencies && yarn quasar prepare

RUN yarn lint && \
  TASKYON_BUILD_CHECKS_COMPLETED=1 yarn quasar build --debug

# Define a common Nginx stage
FROM docker.io/library/nginx:latest AS base-nginx

# Create custom Nginx configuration
RUN cat > /etc/nginx/conf.d/template.conf <<'EOF'
server {
    #listen ${NGINX_PORT};
    listen 9000;
    server_name _; # all hostnames
    #server_name localhost; # all hostnames

    root /usr/share/nginx/html;
    index index.html;
    charset utf-8;

    add_header X-Frame-Options "SAMEORIGIN";
    add_header X-XSS-Protection "1; mode=block";
    add_header X-Content-Type-Options "nosniff";

    # Cache-Control header (1 hour minimum for all assets)
    add_header Cache-Control "public, max-age=3600, immutable" always;

    # SPA history mode: try static file, then directory, then fall back to index.html
    location / {
        try_files $uri $uri/ /index.html;
    }

    # This stable URL changes when a new image is deployed.
    location = /build-metadata.json {
        add_header Cache-Control "no-store" always;
    }

    # Optional: Longer caching for versioned static assets
    # location ~* \.\w{8}\.(css|js)$ {
    #     add_header Cache-Control "public, max-age=31536000, immutable" always;
    # }

    # Send *all* 403/404s to index.html as 200 so the SPA router can handle them
    error_page 403 404 =200 /index.html;
    location = /index.html {
        # this uses the same root as above
    }

    location = /robots.txt  { access_log off; log_not_found off; }

    access_log /dev/stdout combined;
    error_log /dev/stderr error;

    #access_log off;
    #error_log  /var/log/nginx/error.log error;

    # Deny access to hidden files except .well-known
    location ~ /\.(?!well-known).* {
        deny all;
    }
}
EOF

# Production serving stage
FROM base-nginx AS production
COPY --from=production-builder /app/dist/spa /usr/share/nginx/html
COPY --from=build-metadata /metadata/build-metadata.json /usr/share/nginx/html/
RUN cp /etc/nginx/conf.d/template.conf /etc/nginx/conf.d/default.conf
EXPOSE 9000
STOPSIGNAL SIGTERM
CMD ["nginx", "-g", "daemon off;"]

# Debug serving stage
FROM base-nginx AS debug
COPY --from=debug-builder /app/dist/spa /usr/share/nginx/html
COPY --from=build-metadata /metadata/build-metadata.json /usr/share/nginx/html/
RUN cp /etc/nginx/conf.d/template.conf /etc/nginx/conf.d/default.conf
EXPOSE 9000
STOPSIGNAL SIGTERM
CMD ["nginx-debug", "-g", "daemon off;"]
################# HTTPS serving stage for local/debug
FROM debug-builder AS https
COPY --from=build-metadata /metadata/build-metadata.json /app/dist/spa/

STOPSIGNAL SIGTERM
EXPOSE 9000
CMD ["yarn", "quasar", "serve", "--history", "--https", "-p 9000", "dist/spa/"]

#########################################################
# ───────────────────────────────────────────────────────
# Bundle with Tauri for desktop
# ───────────────────────────────────────────────────────
FROM production-builder AS tauri-builder

ENV DEBIAN_FRONTEND=noninteractive

# Install native build tools, GTK/WebKit2 and full EGL/GL + X11 support
RUN apt-get update && \
    apt-get install -y \
      build-essential \
      cmake \
      python3 \
      make \
      g++ \
      libwebkit2gtk-4.1-dev \
      libjavascriptcoregtk-4.1-dev \
      libsoup-3.0-dev \
      libgtk-3-dev \
      libglib2.0-dev pkg-config \
      libayatana-appindicator3-dev \
      libxdo-dev \
      librsvg2-dev \
      libssl-dev \
      # graphics/runtime libs:
      libgl1-mesa-dev \
      libegl1-mesa-dev \
      libgl1-mesa-dri \
      libdrm2 \
      libgbm1 \
      libx11-dev \
      libxrandr-dev \
      libxss-dev \
      libxcomposite-dev \
      libxcursor-dev \
      libxdamage-dev \
      libxi-dev \
      libdbus-1-dev && \
    rm -rf /var/lib/apt/lists/*


# this is only for debuggin to confirm we have the correct libraries...
#RUN find / -name glib-2.0.pc 2>/dev/null
ENV PKG_CONFIG_PATH=/usr/lib/x86_64-linux-gnu/pkgconfig:/usr/share/pkgconfig
RUN pkg-config --libs --cflags glib-2.0

# Install Rust toolchain non‑interactively and source its env immediately
# 1) Mount caches at /tmp/…  
# 2) Install rustup into them  
# 3) Copy into real home dirs
RUN --mount=type=cache,target=/tmp/cargo-home \
    --mount=type=cache,target=/tmp/rustup-home \
    CARGO_HOME=/tmp/cargo-home RUSTUP_HOME=/tmp/rustup-home \
      curl --proto '=https' --tlsv1.2 https://sh.rustup.rs -sSf \
      | sh -s -- -y \
    && cp -a /tmp/cargo-home /root/.cargo \
    && cp -a /tmp/rustup-home /root/.rustup

# Make sure cargo/bin stays on PATH for every subsequent RUN
ENV PATH="/root/.cargo/bin:${PATH}"
ENV HOME="/root"

# Build the Tauri bundle
COPY --from=build-metadata /metadata/build-metadata.json /app/dist/spa/
RUN yarn tauri build

# ───────────────────────────────────────────────────────
# Runtime container for headless Tauri mode
# ───────────────────────────────────────────────────────
FROM docker.io/library/debian:bookworm-slim AS tauri-headless-runtime

ENV DEBIAN_FRONTEND=noninteractive

RUN apt-get update && \
    apt-get install -y --no-install-recommends \
      ca-certificates \
      glib-networking \
      xvfb \
      libwebkit2gtk-4.1-0 \
      libjavascriptcoregtk-4.1-0 \
      libsoup-3.0-0 \
      libgtk-3-0 \
      libglib2.0-0 \
      libayatana-appindicator3-1 \
      libxdo3 \
      libdbus-1-3 && \
    rm -rf /var/lib/apt/lists/*

# Ensure GIO finds the TLS backend module in slim environments.
ENV GIO_MODULE_DIR=/usr/lib/x86_64-linux-gnu/gio/modules

COPY --from=tauri-builder /app/src-tauri/target/release/app /usr/local/bin/taskyon

STOPSIGNAL SIGTERM
ENTRYPOINT ["xvfb-run", "-a", "/usr/local/bin/taskyon", "--headless"]

# ───────────────────────────────────────────────────────
# Extract Tauri 
# ───────────────────────────────────────────────────────
# FROM scratch AS export # we can't do this, because we need the "copy" command
FROM docker.io/library/busybox:latest AS export
COPY --from=tauri-builder /app/src-tauri/target/release/bundle/ /bundle
CMD cp -rv /bundle/* /out/
