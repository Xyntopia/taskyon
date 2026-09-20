#!/usr/bin/env bash
set -euo pipefail

GIT_HASH=$(git rev-parse --short HEAD)
BUILD_COMMIT=$(git rev-parse --verify HEAD)
PUBLISH_DATE=$(date -u +'%Y-%m-%dT%H:%M:%SZ')
DATE_TAG=$(date +'%Y%m%d')

IMAGE_NAME="xyntopia/taskyon"
BUILD_STAGE="production"

if ! command -v podman >/dev/null 2>&1; then
  echo "ERROR: podman is required to build the SPA image"
  exit 1
fi

podman build \
  --target "${BUILD_STAGE}" \
  --build-arg "COMMIT_HASH=${BUILD_COMMIT}" \
  --build-arg "PUBLISH_DATE=${PUBLISH_DATE}" \
  -t "${IMAGE_NAME}:latest" .

podman tag "${IMAGE_NAME}:latest" "${IMAGE_NAME}:${GIT_HASH}"
podman tag "${IMAGE_NAME}:latest" "${IMAGE_NAME}:${DATE_TAG}"

echo "SUCCESS: image built locally:"
echo "  - ${IMAGE_NAME}:latest"
echo "  - ${IMAGE_NAME}:${GIT_HASH}"
echo "  - ${IMAGE_NAME}:${DATE_TAG}"
echo "  - transfer with: podman save ${IMAGE_NAME}:${GIT_HASH}"
