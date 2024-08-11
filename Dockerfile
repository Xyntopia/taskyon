# Stage 1: Build the Quasar application
FROM node:18-alpine as builder

# Set working directory
WORKDIR /app

# Copy the project files to the container
COPY . .

# Install dependencies
RUN yarn install

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
