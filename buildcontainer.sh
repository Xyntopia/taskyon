#!/bin/bash

# Extract version details
GIT_HASH=$(git rev-parse --short HEAD)
DATE_TAG=$(date +'%Y%m%d')

# Docker image name
IMAGE_NAME="xyntopia/taskyon-server"
BUILD_STAGE="ssr-server"  # Change this to your desired build stage

# Build the image
docker build -t ${IMAGE_NAME}:latest .

# Tag the image with Git hash and date
docker tag ${IMAGE_NAME}:latest ${IMAGE_NAME}:${GIT_HASH}
docker tag ${IMAGE_NAME}:latest ${IMAGE_NAME}:${DATE_TAG}

# Push all tags
docker push ${IMAGE_NAME}:latest
docker push ${IMAGE_NAME}:${GIT_HASH}
docker push ${IMAGE_NAME}:${DATE_TAG}

echo "Image pushed with tags:"
echo "  - ${IMAGE_NAME}:latest"
echo "  - ${IMAGE_NAME}:${GIT_HASH}"
echo "  - ${IMAGE_NAME}:${DATE_TAG}"
