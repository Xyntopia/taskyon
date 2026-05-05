#!/usr/bin/env bash
set -euo pipefail

TASKYON_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../.." && pwd)"
RUMOCA_DIR="$TASKYON_ROOT/packages/rumoca"
WRAPPER="$TASKYON_ROOT/packages/shared/modelica/scripts/omc-via-podman.sh"
MSL_VERSION="${MSL_VERSION:-4.1.0}"
MSL_CACHE_ROOT="${RUMOCA_MSL_CACHE_DIR:-$RUMOCA_DIR/target/msl}"
MSL_DIR="$MSL_CACHE_ROOT/ModelicaStandardLibrary-$MSL_VERSION"
MSL_ZIP="$MSL_CACHE_ROOT/ModelicaStandardLibrary-$MSL_VERSION.zip"
MSL_SOURCE_URL="${MSL_SOURCE_URL:-https://github.com/modelica/ModelicaStandardLibrary/archive/refs/tags/v$MSL_VERSION.zip}"

if [ ! -x "$WRAPPER" ]; then
  echo "[generate-omc-traces-via-podman] missing executable wrapper: $WRAPPER" >&2
  exit 1
fi
if ! command -v cargo >/dev/null 2>&1; then
  echo "[generate-omc-traces-via-podman] cargo is required but was not found in PATH" >&2
  exit 1
fi
if ! command -v curl >/dev/null 2>&1; then
  echo "[generate-omc-traces-via-podman] curl is required but was not found in PATH" >&2
  exit 1
fi

OMC_PROXY_BIN_DIR="$(mktemp -d)"
cleanup() {
  rm -rf "$OMC_PROXY_BIN_DIR"
}
trap cleanup EXIT

ln -sf "$WRAPPER" "$OMC_PROXY_BIN_DIR/omc"

ensure_msl_cache() {
  local sentinel_a="$MSL_DIR/Complex.mo"
  local sentinel_b="$MSL_DIR/Modelica 4.1.0/package.mo"
  local sentinel_b_legacy="$MSL_DIR/Modelica/package.mo"
  if [ -f "$sentinel_a" ] && { [ -f "$sentinel_b" ] || [ -f "$sentinel_b_legacy" ]; }; then
    return
  fi

  echo "[generate-omc-traces-via-podman] preparing MSL cache at: $MSL_DIR"
  mkdir -p "$MSL_CACHE_ROOT"

  if [ ! -s "$MSL_ZIP" ]; then
    echo "[generate-omc-traces-via-podman] downloading MSL zip: $MSL_SOURCE_URL"
    curl -fsSL "$MSL_SOURCE_URL" -o "$MSL_ZIP"
  else
    echo "[generate-omc-traces-via-podman] using cached MSL zip: $MSL_ZIP"
  fi

  rm -rf "$MSL_DIR"
  if command -v unzip >/dev/null 2>&1; then
    unzip -q -o "$MSL_ZIP" -d "$MSL_CACHE_ROOT"
  elif command -v python3 >/dev/null 2>&1; then
    python3 -m zipfile -e "$MSL_ZIP" "$MSL_CACHE_ROOT"
  else
    echo "[generate-omc-traces-via-podman] need unzip or python3 to extract $MSL_ZIP" >&2
    exit 1
  fi

  if [ ! -f "$sentinel_a" ] || { [ ! -f "$sentinel_b" ] && [ ! -f "$sentinel_b_legacy" ]; }; then
    echo "[generate-omc-traces-via-podman] extracted MSL cache is incomplete: $MSL_DIR" >&2
    exit 1
  fi
}

DEFAULT_TARGETS_REL="crates/rumoca-test-msl/tests/msl_tests/msl_simulation_targets_180.json"
DEFAULT_ARGS=(
  --target-models-file "$DEFAULT_TARGETS_REL"
  --workers 1
  --omc-threads 1
)

if [ "$#" -gt 0 ]; then
  EXTRA_ARGS=("$@")
else
  EXTRA_ARGS=()
fi

echo "[generate-omc-traces-via-podman] using OMC image: ${OMC_PODMAN_IMAGE:-openmodelica/openmodelica:v1.26.1-gui}"
echo "[generate-omc-traces-via-podman] rumoca dir: $RUMOCA_DIR"

ensure_msl_cache

echo "[generate-omc-traces-via-podman] checking omc via podman..."
PATH="$OMC_PROXY_BIN_DIR:$PATH" "$OMC_PROXY_BIN_DIR/omc" --version

echo "[generate-omc-traces-via-podman] generating OMC simulation references + traces..."
(
  cd "$RUMOCA_DIR"
  PATH="$OMC_PROXY_BIN_DIR:$PATH" \
    RUMOCA_MSL_CACHE_DIR="$MSL_CACHE_ROOT" \
    cargo run --release --package rumoca-tool-dev --bin rumoca-msl-tools -- \
      omc-simulation-reference \
      "${DEFAULT_ARGS[@]}" \
      "${EXTRA_ARGS[@]}"
)

echo "[generate-omc-traces-via-podman] done"
echo "  reference: $RUMOCA_DIR/target/msl/results/omc_simulation_reference.json"
echo "  omc traces: $RUMOCA_DIR/target/msl/results/sim_traces/omc"

TRACE_DIR="$RUMOCA_DIR/target/msl/results/sim_traces/omc"
TRACE_COUNT="$(find "$TRACE_DIR" -maxdepth 1 -type f -name '*.json' 2>/dev/null | wc -l | tr -d ' ')"
if [ "${TRACE_COUNT:-0}" -eq 0 ]; then
  echo "[generate-omc-traces-via-podman] no OMC trace JSON files were generated in: $TRACE_DIR" >&2
  echo "[generate-omc-traces-via-podman] rerun with OMC_PODMAN_DEBUG=1 to inspect container paths and arguments." >&2
  exit 1
fi

echo "[generate-omc-traces-via-podman] trace files generated: $TRACE_COUNT"
