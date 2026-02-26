# Stage 1: Build the Quasar application
FROM node:22.14.0 AS prepare
# Set up Yarn cache directory
ENV YARN_CACHE_FOLDER=/tmp/.yarn-cache

# make sure, subsequent installs use corepack properly (e.g. xorrect yarn version)
ENV COREPACK_ENABLE_STRICT=1
RUN corepack enable


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

# Copy package.json and yarn.lock first to leverage Docker's cache
COPY package.json yarn.lock .yarnrc.yml /app/

# Also copy child packages!
# COPY --parents packages/*/package.json .
COPY packages/tyclient/package.json /app/packages/tyclient/
COPY packages/taskyon/package.json /app/packages/taskyon/
COPY packages/secure-tunnel/package.json /app/packages/secure-tunnel/

RUN ls -a packages/*

# Install dependencies with cache and ignore optional dependencies
#RUN --mount=type=cache,target=$YARN_CACHE_FOLDER yarn install --frozen-lockfile --ignore-optional
RUN --mount=type=cache,target=$YARN_CACHE_FOLDER yarn install

# Copy the rest of the project files
COPY . .

FROM prepare AS production-builder

# this should build the app inside the folder /app/dist/spa
RUN ls -la && yarn quasar prepare && yarn build

# ───────────────────────────────────────────────────────
# build debug build
# ───────────────────────────────────────────────────────

FROM prepare AS debug-builder

RUN ls -la && yarn quasar prepare

RUN ls -la && yarn quasar prepare && yarn quasar build --debug

FROM prepare AS server-builder

RUN ls -la && yarn quasar prepare && yarn quasar build -m ssr #--debug

# Define a common Nginx stage
FROM nginx AS base-nginx

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
RUN cp /etc/nginx/conf.d/template.conf /etc/nginx/conf.d/default.conf
EXPOSE 9000
STOPSIGNAL SIGTERM
CMD ["nginx", "-g", "daemon off;"]

# Debug serving stage
FROM base-nginx AS debug
COPY --from=debug-builder /app/dist/spa /usr/share/nginx/html
RUN cp /etc/nginx/conf.d/template.conf /etc/nginx/conf.d/default.conf
EXPOSE 9000
STOPSIGNAL SIGTERM
CMD ["nginx-debug", "-g", "daemon off;"]


# Stage 3: Serve the SSR application
FROM node:22.10.0-alpine AS ssr-server
#FROM node:22.10.0 as ssr-server

# Copy the built files from the server-builder stage
COPY --from=server-builder /app/dist/ssr /app

# Install dependencies
WORKDIR /app
RUN yarn install --immutable
ENV SSR_REQUEST_TIMEOUT_MS=0
ENV SSR_SOCKET_TIMEOUT_MS=0

EXPOSE 3000
STOPSIGNAL SIGTERM
# Start the SSR server
CMD ["yarn", "start"]


################# HTTPS serving stage for local/debug
FROM debug-builder AS https

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
RUN yarn tauri build

# ───────────────────────────────────────────────────────
# Extract Tauri 
# ───────────────────────────────────────────────────────
# FROM scratch AS export # we can't do this, because we need the "copy" command
FROM busybox AS export
COPY --from=tauri-builder /app/src-tauri/target/release/bundle/ /bundle
CMD cp -rv /bundle/* /out/
