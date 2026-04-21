#!/usr/bin/env bash
set -euo pipefail

if ! command -v podman >/dev/null 2>&1; then
  echo "[omc-via-podman] podman is required but was not found in PATH" >&2
  exit 1
fi

IMAGE="${OMC_PODMAN_IMAGE:-openmodelica/openmodelica:v1.26.1-gui}"
SCRIPT_PATH="${BASH_SOURCE[0]}"
while [ -L "$SCRIPT_PATH" ]; do
  LINK_DIR="$(cd "$(dirname "$SCRIPT_PATH")" && pwd)"
  SCRIPT_PATH="$(readlink "$SCRIPT_PATH")"
  case "$SCRIPT_PATH" in
    /*) ;;
    *) SCRIPT_PATH="$LINK_DIR/$SCRIPT_PATH" ;;
  esac
done
SCRIPT_DIR="$(cd "$(dirname "$SCRIPT_PATH")" && pwd)"
TASKYON_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"
HOST_WORKSPACE_ROOT="${OMC_PODMAN_WORKSPACE_ROOT:-$TASKYON_ROOT}"
CONTAINER_WORKSPACE_ROOT="${OMC_PODMAN_CONTAINER_ROOT:-/workspace}"
HOST_CWD="$(pwd)"
CONTAINER_WORKDIR="${OMC_PODMAN_WORKDIR:-}"

if [ ! -d "$HOST_WORKSPACE_ROOT" ]; then
  echo "[omc-via-podman] workspace root does not exist: $HOST_WORKSPACE_ROOT" >&2
  exit 1
fi

map_arg_path() {
  local arg="$1"
  case "$arg" in
    "$HOST_WORKSPACE_ROOT")
      printf '%s' "$CONTAINER_WORKSPACE_ROOT"
      ;;
    "$HOST_WORKSPACE_ROOT"/*)
      printf '%s%s' "$CONTAINER_WORKSPACE_ROOT" "${arg#$HOST_WORKSPACE_ROOT}"
      ;;
    *)
      printf '%s' "$arg"
      ;;
  esac
}

TMP_DIR=""
TMP_FILES=()

cleanup() {
  if [ ${#TMP_FILES[@]} -gt 0 ]; then
    rm -f "${TMP_FILES[@]}" || true
  fi
  if [ -n "$TMP_DIR" ] && [ -d "$TMP_DIR" ]; then
    rmdir "$TMP_DIR" 2>/dev/null || true
  fi
}
trap cleanup EXIT

rewrite_mos_if_needed() {
  local arg="$1"
  if [[ "$arg" != *.mos ]]; then
    printf '%s' "$arg"
    return
  fi
  if [ ! -f "$arg" ]; then
    printf '%s' "$arg"
    return
  fi

  if [ -z "$TMP_DIR" ]; then
    TMP_DIR="$HOST_WORKSPACE_ROOT/.omc-via-podman-tmp"
    mkdir -p "$TMP_DIR"
  fi

  local base
  base="$(basename "$arg")"
  local stem="${base%.mos}"
  local rewritten="$TMP_DIR/${stem}.rewritten.$$.mos"
  local escaped_host_root escaped_container_root
  escaped_host_root="$(printf '%s' "$HOST_WORKSPACE_ROOT" | sed 's/[.[\*^$()+?{}|]/\\&/g')"
  escaped_container_root="$(printf '%s' "$CONTAINER_WORKSPACE_ROOT" | sed 's/[&]/\\&/g')"
  sed "s|$escaped_host_root|$escaped_container_root|g" "$arg" > "$rewritten"
  TMP_FILES+=("$rewritten")
  printf '%s' "$rewritten"
}

ARGS=()
for arg in "$@"; do
  rewritten="$(rewrite_mos_if_needed "$arg")"
  ARGS+=("$(map_arg_path "$rewritten")")
done

if [ -z "$CONTAINER_WORKDIR" ]; then
  CONTAINER_WORKDIR="$(map_arg_path "$HOST_CWD")"
fi

if [ "${OMC_PODMAN_DEBUG:-0}" = "1" ]; then
  echo "[omc-via-podman] host cwd: $HOST_CWD"
  echo "[omc-via-podman] container workdir: $CONTAINER_WORKDIR"
  echo "[omc-via-podman] args: ${ARGS[*]}"
fi

exec podman run --rm \
  --userns=keep-id \
  -u "$(id -u):$(id -g)" \
  -v "$HOST_WORKSPACE_ROOT:$CONTAINER_WORKSPACE_ROOT:rw,z" \
  -w "$CONTAINER_WORKDIR" \
  "$IMAGE" \
  omc "${ARGS[@]}"
