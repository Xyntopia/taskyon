# Stage 1: Build the Quasar application
FROM node:22.10.0 as prepare

# Set up Yarn cache directory
ENV YARN_CACHE_FOLDER=/app/.yarn-cache

# we don't need to bust the cache here, because it  gets thrown away due to our staged build anyways...
# Install dependencies for native modules
RUN apt-get update && apt-get install -y \
    python3 \
    make \
    g++ \
    # for some reason, the following is needed to run yarn install...
    libcairo2-dev libjpeg-dev libgif-dev \
    libpangocairo-1.0-0 libpango1.0-dev \
    libvips-dev libjpeg-dev libpng-dev

# Set working directory
WORKDIR /app

# Copy package.json and yarn.lock first to leverage Docker's cache
COPY package.json yarn.lock /app/

# Install dependencies with cache and ignore optional dependencies
#RUN --mount=type=cache,target=$YARN_CACHE_FOLDER yarn install --frozen-lockfile --ignore-optional
RUN --mount=type=cache,target=$YARN_CACHE_FOLDER yarn install

# Copy the rest of the project files
COPY . .

FROM prepare as builder

RUN ls -la && yarn quasar prepare

# Build the static site
RUN yarn quasar build

# Stage 2: Serve the built site with a web server
FROM nginx:alpine

# Copy the built files from the previous stage
COPY --from=builder /app/dist/spa /usr/share/nginx/html

# Expose port 80
EXPOSE 80

# Start Nginx server
CMD ["nginx", "-g", "daemon off;"]
