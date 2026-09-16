#!/usr/bin/env bash
set -euo pipefail

GIT_HASH=$(git rev-parse --short HEAD)
DATE_TAG=$(date +'%Y%m%d')

IMAGE_NAME="xyntopia/taskyon-relay"
BUILD_FILE="Dockerfile.relay"

if ! command -v podman >/dev/null 2>&1; then
  echo "ERROR: podman is required to build the relay image"
  exit 1
fi

podman login --get-login docker.io >/dev/null 2>&1 || {
  echo "ERROR: not logged into docker.io (podman login required)"
  exit 1
}

podman build -f "${BUILD_FILE}" -t "${IMAGE_NAME}:latest" .

podman tag "${IMAGE_NAME}:latest" "${IMAGE_NAME}:${GIT_HASH}"
podman tag "${IMAGE_NAME}:latest" "${IMAGE_NAME}:${DATE_TAG}"

push_tag () {
  local tag="$1"
  echo "Pushing ${IMAGE_NAME}:${tag} ..."
  podman push "${IMAGE_NAME}:${tag}"
}

push_tag latest
push_tag "${GIT_HASH}"
push_tag "${DATE_TAG}"

echo "SUCCESS: all image tags pushed:"
echo "  - ${IMAGE_NAME}:latest"
echo "  - ${IMAGE_NAME}:${GIT_HASH}"
echo "  - ${IMAGE_NAME}:${DATE_TAG}"
