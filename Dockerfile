# Stage 1: Build the Quasar application
FROM node:18-alpine as builder

# Install dependencies for native modules
RUN apk add --no-cache \
    python3 \
    make \
    g++ \
    zlib-dev

# Set working directory
WORKDIR /app

# Copy package.json and yarn.lock first to leverage Docker's cache
COPY package.json yarn.lock ./

# Install dependencies with cache and ignore optional dependencies
RUN --mount=type=cache,target=/root/.yarn YARN_CACHE_FOLDER=/root/.yarn yarn install --frozen-lockfile --ignore-optional

# Copy the rest of the project files
COPY . .

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
