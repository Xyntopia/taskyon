#!/usr/bin/env bash
set -euo pipefail

GIT_HASH=$(git rev-parse --short HEAD)
DATE_TAG=$(date +'%Y%m%d')

IMAGE_NAME="xyntopia/taskyon-server"
BUILD_STAGE="ssr-server"  # Change this to your desired build stage

# Fail early if not logged in.
# `docker whoami` is not available in all Docker CLI versions (e.g. 28.x),
# so fall back to checking Docker Hub auth in config.json.
is_logged_into_docker_hub() {
  if docker whoami >/dev/null 2>&1; then
    return 0
  fi

  local docker_cfg="${DOCKER_CONFIG:-$HOME/.docker}/config.json"
  [[ -r "${docker_cfg}" ]] || return 1

  grep -Eq '"https://index\.docker\.io/v1/"|"registry-1\.docker\.io"|"docker\.io"' "${docker_cfg}"
}

is_logged_into_docker_hub || {
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
