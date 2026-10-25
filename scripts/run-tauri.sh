#!/usr/bin/env bash
set -euo pipefail

# Native GTK/WebKit libraries belong to Tauri, not every program in nix develop.
# Outside Nix the variable is absent and the original host environment is kept.
if [[ -n "${TASKYON_TAURI_LIBRARY_PATH:-}" ]]; then
  export LD_LIBRARY_PATH="$TASKYON_TAURI_LIBRARY_PATH"
fi

exec ./node_modules/.bin/tauri "$@"
