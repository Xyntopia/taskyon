#!/usr/bin/env bash
# Run a command with a private, persistent Secret Service for headless desktop diagnostics.
# Linux desktop builds keep device private keys in the OS vault, which needs an unlocked Secret
# Service reachable over a session bus. This helper starts both without touching the desktop login
# keyring: the headless identity lives in its own keyring directory together with its password.
set -euo pipefail

if [[ $# -eq 0 ]]; then
  echo "usage: $0 <command> [args...]" >&2
  exit 2
fi

missing_tools=()
for tool in dbus-run-session dbus-daemon dbus-send gnome-keyring-daemon; do
  command -v "$tool" >/dev/null 2>&1 || missing_tools+=("$tool")
done
if [[ ${#missing_tools[@]} -gt 0 ]]; then
  echo "Missing required tools: ${missing_tools[*]}" >&2
  echo "Run this from the project development shell, which provides dbus and gnome-keyring." >&2
  exit 127
fi

keyring_home="${TASKYON_HEADLESS_KEYRING_HOME:-${XDG_DATA_HOME:-$HOME/.local/share}/taskyon-headless-keyring}"
password_file="$keyring_home/password"
mkdir -p "$keyring_home"
chmod 700 "$keyring_home"

if [[ -z "${TASKYON_HEADLESS_KEYRING_PASSWORD:-}" && ! -f "$password_file" ]]; then
  if [[ -e "$keyring_home/keyrings/login.keyring" ]]; then
    echo "Refusing to create a new identity: $keyring_home/keyrings/login.keyring exists without" >&2
    echo "$password_file. Restore the password file or set TASKYON_HEADLESS_KEYRING_PASSWORD." >&2
    exit 1
  fi
  umask 077
  head -c 32 /dev/urandom | base64 >"$password_file"
  chmod 600 "$password_file"
fi

dbus_config="$(dirname "$(command -v dbus-daemon)")/../share/dbus-1/session.conf"
dbus_options=()
if [[ -f "$dbus_config" ]]; then
  dbus_options+=(--config-file="$dbus_config")
fi

export TASKYON_HEADLESS_KEYRING_HOME="$keyring_home"
export TASKYON_HEADLESS_PREVIOUS_XDG_DATA_HOME="${XDG_DATA_HOME:-}"

exec dbus-run-session "${dbus_options[@]}" -- bash -c '
  set -euo pipefail
  keyring_home="$TASKYON_HEADLESS_KEYRING_HOME"

  secrets_owned() {
    dbus-send --session --print-reply --dest=org.freedesktop.DBus /org/freedesktop/DBus \
      org.freedesktop.DBus.NameHasOwner string:org.freedesktop.secrets 2>/dev/null |
      grep -q "boolean true"
  }

  stop_keyring() {
    kill "$daemon_pid" 2>/dev/null || true
    wait "$daemon_pid" 2>/dev/null || true
  }

  export XDG_DATA_HOME="$keyring_home"
  if [[ -n "${TASKYON_HEADLESS_KEYRING_PASSWORD:-}" ]]; then
    password="$TASKYON_HEADLESS_KEYRING_PASSWORD"
  else
    password="$(<"$keyring_home/password")"
  fi
  printf "%s" "$password" | gnome-keyring-daemon --unlock --foreground --components=secrets >/dev/null &
  daemon_pid=$!
  trap stop_keyring EXIT INT TERM

  for _ in $(seq 1 100); do
    secrets_owned && break
    sleep 0.1
  done
  if ! secrets_owned; then
    echo "gnome-keyring did not take over org.freedesktop.secrets within 10 seconds." >&2
    exit 1
  fi

  if [[ -n "$TASKYON_HEADLESS_PREVIOUS_XDG_DATA_HOME" ]]; then
    export XDG_DATA_HOME="$TASKYON_HEADLESS_PREVIOUS_XDG_DATA_HOME"
  else
    unset XDG_DATA_HOME
  fi
  unset TASKYON_HEADLESS_KEYRING_HOME
  unset TASKYON_HEADLESS_KEYRING_PASSWORD
  unset TASKYON_HEADLESS_PREVIOUS_XDG_DATA_HOME
  exec "$@"
' -- "$@"
