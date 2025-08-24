# Stage 1: Build the Quasar application
FROM node:22.14.0 AS prepare

# Set up Yarn cache directory
ENV YARN_CACHE_FOLDER=/app/.yarn-cache

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
COPY package.json yarn.lock /app/

# Also copy child packages!
# COPY --parents packages/*/package.json .
COPY packages/tyclient/package.json /app/packages/tyclient/
COPY packages/taskyon/package.json /app/packages/taskyon/

RUN ls -a packages/*

# Install dependencies with cache and ignore optional dependencies
#RUN --mount=type=cache,target=$YARN_CACHE_FOLDER yarn install --frozen-lockfile --ignore-optional
RUN --mount=type=cache,target=$YARN_CACHE_FOLDER yarn install

# Copy the rest of the project files
COPY . .

FROM prepare AS production-builder

# this should build the app inside the folder /app/dist/spa
RUN ls -la && yarn quasar prepare && yarn build


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

    add_header X-Frame-Options "SAMEORIGIN";
    add_header X-XSS-Protection "1; mode=block";
    add_header X-Content-Type-Options "nosniff";

    # Cache-Control header (1 hour minimum for all assets)
    add_header Cache-Control "public, max-age=3600, immutable" always;

    index index.html;

    charset utf-8;

    location / {
        try_files $uri $uri/ /index.html;

        # Optional: Longer caching for versioned static assets
        # location ~* \.\w{8}\.(css|js)$ {
        #     add_header Cache-Control "public, max-age=31536000, immutable" always;
        # }
    }

    location = /robots.txt  { access_log off; log_not_found off; }

    access_log /dev/stdout combined;
    error_log /dev/stderr error;

    #access_log off;
    #error_log  /var/log/nginx/error.log error;

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
CMD ["nginx-debug", "-g", "daemon off;"]

# Debug serving stage
FROM base-nginx AS debug
COPY --from=debug-builder /app/dist/spa /usr/share/nginx/html
RUN cp /etc/nginx/conf.d/template.conf /etc/nginx/conf.d/default.conf
EXPOSE 9000
STOPSIGNAL SIGTERM
CMD ["nginx", "-g", "daemon off;"]


# Stage 3: Serve the SSR application
FROM node:22.10.0-alpine AS ssr-server
#FROM node:22.10.0 as ssr-server

# Copy the built files from the server-builder stage
COPY --from=server-builder /app/dist/ssr /app

# Install dependencies
WORKDIR /app
RUN yarn install --frozen-lockfile --ignore-optional

EXPOSE 3000
STOPSIGNAL SIGTERM
# Start the SSR server
CMD ["yarn", "start"]