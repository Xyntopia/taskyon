#!/usr/bin/env bash
set -euo pipefail

if [[ $# -eq 0 ]]; then
  echo "usage: $0 <command> [args...]" >&2
  exit 2
fi

if command -v xvfb-run >/dev/null 2>&1; then
  exec xvfb-run -a "$@"
fi

if ! command -v Xvfb >/dev/null 2>&1; then
  echo "Neither xvfb-run nor Xvfb was found in PATH." >&2
  exit 127
fi

pick_display() {
  local n
  for n in $(seq 99 140); do
    if [[ ! -e "/tmp/.X${n}-lock" && ! -S "/tmp/.X11-unix/X${n}" ]]; then
      echo "$n"
      return 0
    fi
  done
  return 1
}

display="$(pick_display || true)"
if [[ -z "${display:-}" ]]; then
  echo "Could not find a free X display slot for Xvfb." >&2
  exit 1
fi

Xvfb ":$display" -screen 0 1280x800x24 -nolisten tcp >/tmp/taskyon-xvfb.log 2>&1 &
xvfb_pid=$!

cleanup() {
  kill "$xvfb_pid" >/dev/null 2>&1 || true
}
trap cleanup EXIT INT TERM

sleep 0.4
if ! kill -0 "$xvfb_pid" >/dev/null 2>&1; then
  echo "Xvfb failed to start. See /tmp/taskyon-xvfb.log" >&2
  exit 1
fi

DISPLAY=":$display" "$@"
