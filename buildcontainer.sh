#!/usr/bin/env bash
set -euo pipefail

GIT_HASH=$(git rev-parse --short HEAD)
DATE_TAG=$(date +'%Y%m%d')

IMAGE_NAME="xyntopia/taskyon-server"
BUILD_STAGE="ssr-server"  # Change this to your desired build stage

# Fail early if not logged in
docker whoami >/dev/null 2>&1 || {
  echo "ERROR: not logged into Docker Hub (docker login required)"
  exit 1
}

docker build --target ${BUILD_STAGE} -t ${IMAGE_NAME}:latest .

docker tag ${IMAGE_NAME}:latest ${IMAGE_NAME}:${GIT_HASH}
docker tag ${IMAGE_NAME}:latest ${IMAGE_NAME}:${DATE_TAG}

push_tag () {
  local tag="$1"
  echo "Pushing ${IMAGE_NAME}:${tag} ..."
  docker push "${IMAGE_NAME}:${tag}"
}

push_tag latest
push_tag "${GIT_HASH}"
push_tag "${DATE_TAG}"

echo "SUCCESS: all image tags pushed:"
echo "  - ${IMAGE_NAME}:latest"
echo "  - ${IMAGE_NAME}:${GIT_HASH}"
echo "  - ${IMAGE_NAME}:${DATE_TAG}"
