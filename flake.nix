{
  description = "Nix Development Flake for Quasar";

  inputs = {
    flake-utils.url = "github:numtide/flake-utils";
    nixpkgs_unstable.url = "github:NixOS/nixpkgs/nixos-unstable";
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-26.05";
  };

  outputs =
    {
      self,
      nixpkgs,
      nixpkgs_unstable,
      flake-utils,
    }:

    flake-utils.lib.eachDefaultSystem (
      system:
      let
        # https://nixos.wiki/wiki/Rust
        # https://nixos.org/manual/nixpkgs/stable/#rust
        # if we want a specific rust version:
        # rust-overlay.url = "github:oxalica/rust-overlay";
        pkgs = import nixpkgs { inherit system; };
        pkgs_unstable = import nixpkgs_unstable { inherit system; };
        python = pkgs.python311;
        mkTycliBin =
          commandName:
          pkgs.writeShellScriptBin commandName ''
            set -euo pipefail
            repo_root="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
            cli_bin="$repo_root/packages/tycli/bin/tycli.cjs"

            if [ ! -f "$cli_bin" ]; then
              echo "$commandName: missing built tycli bundle at $cli_bin" >&2
              echo "$commandName: run yarn tycli:build first" >&2
              exit 1
            fi

            exec node "$cli_bin" "$@"
          '';
        mkTycliDevBin =
          commandName:
          pkgs.writeShellScriptBin commandName ''
            set -euo pipefail
            repo_root="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
            exec yarn --cwd "$repo_root" node --import "$repo_root/packages/tycli/src/register.ts" --experimental-strip-types "$repo_root/packages/tycli/src/cli.ts" "$@"
          '';
        tycliBin = mkTycliBin "tycli";
        tycBin = mkTycliBin "tyc";
        tycliDevBin = mkTycliDevBin "tycli-dev";
        tycDevBin = mkTycliDevBin "tyc-dev";
        prepareRustBin = pkgs.writeShellScriptBin "prepare_rust" ''
          set -euo pipefail

          repo_root="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
          rumoca_root="$repo_root/packages/rumoca"
          toolchain_file="$rumoca_root/rust-toolchain.toml"
          lock_file="$rumoca_root/Cargo.lock"
          expected_wasm_pack="0.13.1"

          if [ ! -f "$toolchain_file" ]; then
            echo "prepare_rust: missing $toolchain_file" >&2
            exit 1
          fi

          if [ ! -f "$lock_file" ]; then
            echo "prepare_rust: missing $lock_file" >&2
            exit 1
          fi

          toolchain="$(sed -n 's/^[[:space:]]*channel[[:space:]]*=[[:space:]]*"\([^"]*\)".*/\1/p' "$toolchain_file" | head -n 1)"
          if [ -z "$toolchain" ]; then
            echo "prepare_rust: could not read pinned Rumoca toolchain from $toolchain_file" >&2
            exit 1
          fi

          expected_wasm_bindgen="$(
            python - <<'PY'
import pathlib, tomllib
lock = tomllib.loads(pathlib.Path("packages/rumoca/Cargo.lock").read_text())
versions = sorted(
    {
        pkg["version"]
        for pkg in lock.get("package", [])
        if pkg.get("name") == "wasm-bindgen"
    }
)
if not versions:
    raise SystemExit("failed to discover wasm-bindgen version in packages/rumoca/Cargo.lock")
print(versions[-1])
PY
          )"

          echo "[prepare_rust] Installing general Rust toolchain..."
          rustup toolchain install stable

          echo "[prepare_rust] Installing Rumoca pinned toolchain: $toolchain"
          rustup toolchain install "$toolchain"
          rustup target add wasm32-unknown-unknown --toolchain "$toolchain"
          rustup component add rust-src --toolchain "$toolchain"

          echo "[prepare_rust] Installing wasm-bindgen-cli $expected_wasm_bindgen"
          cargo install wasm-bindgen-cli --version "$expected_wasm_bindgen" --locked --force

          echo "[prepare_rust] Installing wasm-pack $expected_wasm_pack"
          cargo install wasm-pack --version "$expected_wasm_pack" --locked --force

          echo "[prepare_rust] Done."
        '';

        # this is all tauri-related stuff
        libraries = with pkgs; [

          # tauri deps
          at-spi2-atk
          atkmm
          cairo
          gdk-pixbuf
          glib
          glib-networking
          gobject-introspection
          gobject-introspection.dev
          gtk3
          harfbuzz
          librsvg
          libsoup_3
          pango
          gh
          webkitgtk_4_1
          webkitgtk_4_1.dev
          #webkitgtk
          #gtk3
          #cairo
          #gdk-pixbuf
          #glib
          #dbus
          #openssl_3
          #librsvg
          #libsoup

          # this is needed for appimage by build_appimage.sh ...
          #libgpg-error
          #xorg.libX11
          #xorg.libSM
          #xorg.libICE
          #xorg.libxcb
          #fribidi
          #fontconfig
          #libthai
          #harfbuzz
          #freetype
          #libglvnd
          #mesa
          #libdrm
          cargo-tauri
          rustup # needed for adding new targets e.g. wasm-bindgen!
          # add rust toolchain
          rustc
          rustfmt # needed in order to compile rumoca
          cargo

          # for cypress e2e testing
          glib
          nss
          nspr
          at-spi2-atk
          cups
          dbus
          libdrm
          gtk2
          gtk3
          pango
          cairo
          alsa-lib
          libX11
          libXcomposite
          libXdamage
          libXext
          libXfixes
          libXrandr
          libxcb
          libxkbcommon
          #xorg
          mesa
          libgbm # for libgbm
          expat
        ];
        packages = with pkgs; [
          # rust
          #rustfmt
          #clippy
          #rustc
          #cargo
          #cargo-deny
          #cargo-edit
          #cargo-watch
          #llvmPackages.bintools
          #rustup
          #rust-analyzer
          #rust-src

          # for tauri
          curl
          wget
          pkg-config
          systemd.dev
          systemd

          # for running local llm models:
          # not sure, why..  but this isn't working, currently.. so we are using docker
          # local-ai

          # node
          # yarn
          # we disable yarn-berry, because it is installed using corepack!
          # yarn-berry
          nodejs_22

          # helpers
          graphviz # we are using this with "madge" in order to display dependency graphs...
          perf # needed for cargo flamegraph (perf-based sampling)
          xorgserver # provides Xvfb / xvfb-run for headless tauri diagnostics on servers

          # supabase
          docker-compose
          # colima # also doesn't work yet somehow...
          # podman # doesn't work with supabase I think
          pkgs_unstable.stripe-cli

          pkgs_unstable.deno

          python # this is needed for newer quasar versions apparently...
          # not sure..  but if I use our git-filter repo form main nix store, it doesn't work.. maybe becuase of cinflicting python versions?
          # git-filter-repo
          kdiff3

          # we use this to search for missing libraries with the same version as this
          # project here.
          # run:
          # > nix-index
          # > nix-locate libgbm.so.1
          nix-index
          tycliBin
          tycBin
          tycliDevBin
          tycDevBin
          prepareRustBin
        ];
      in
      {
        devShells.default = pkgs.mkShell rec {
          # pure  = true;                   # ← turn on “pure” mode
          name = "xyntopia_gui";
          # TODO: what is this for? nativeBuildInputs = [ pkgs.bashInteractive ];
          buildInputs = libraries ++ packages;
          # the following comes from here: https://tauri.app/start/prerequisites/
          # but by declaring LD_LIBRARY_PATH we might have done it correctly already ;)
          # and thats why we're commenting it out...
          #PKG_CONFIG_PATH = "${glib.dev}/lib/pkgconfig:${libsoup_3.dev}/lib/pkgconfig:${webkitgtk_4_1.dev}/lib/pkgconfig:${at-spi2-atk.dev}/lib/pkgconfig:${gtk3.dev}/lib/pkgconfig:${gdk-pixbuf.dev}/lib/pkgconfig:${cairo.dev}/lib/pkgconfig:${pango.dev}/lib/pkgconfig:${harfbuzz.dev}/lib/pkgconfig";
          # propagatedBuildInputs = libraries;  # your GTK/WebKit/etc libs

          shellHook = ''
            # python poetry related stuff
            unset SOURCE_DATE_EPOCH
            unset LD_PRELOAD

            # Environment variables
            # fixes libstdc++ issues, libz.so.1 issues
            export LD_LIBRARY_PATH="${pkgs.stdenv.cc.cc.lib}/lib/:${pkgs.lib.makeLibraryPath buildInputs}";

            export NODE_OPTIONS="--max-old-space-size=8192"
            echo "increasing node memory allocation to $NODE_OPTIONS"



            if [ -f ./.env ]; then
              set -a  # automatically export all variables
              source ./.env
              set +a
            fi

            export PATH="$(pwd)/node_modules/.bin:$PATH:$HOME/.cargo/bin"

            check_rumoca_rust_toolchain() {
              local toolchain_file="$(pwd)/packages/rumoca/rust-toolchain.toml"
              local toolchain=""
              local cargo_bin=""
              local loader=""

              if ! command -v rustup >/dev/null 2>&1; then
                return
              fi

              if [ ! -f "$toolchain_file" ]; then
                return
              fi

              toolchain="$(sed -n 's/^[[:space:]]*channel[[:space:]]*=[[:space:]]*"\([^"]*\)".*/\1/p' "$toolchain_file" | head -n 1)"
              if [ -z "$toolchain" ]; then
                return
              fi

              cargo_bin="$(rustup which cargo --toolchain "$toolchain" 2>/dev/null || true)"
              if [ -z "$cargo_bin" ]; then
                echo "[devShell] Rumoca Rust toolchain '$toolchain' is not installed."
                echo "[devShell] Your general Rust toolchain is usually installed with:"
                echo "[devShell]   rustup toolchain install stable"
                echo "[devShell] Rumoca also needs its pinned toolchain from packages/rumoca/rust-toolchain.toml:"
                echo "[devShell]   rustup toolchain install $toolchain"
                echo "[devShell]   rustup target add wasm32-unknown-unknown --toolchain $toolchain"
                echo "[devShell]   rustup component add rust-src --toolchain $toolchain"
                return
              fi

              if "$cargo_bin" --version >/dev/null 2>&1; then
                return
              fi

              loader="$(${pkgs.binutils}/bin/readelf -l "$cargo_bin" 2>/dev/null | sed -n 's@.*Requesting program interpreter: \(.*\)]@\1@p' | head -n 1)"

              echo "[devShell] Rumoca Rust toolchain '$toolchain' is installed but not executable."
              if [ -n "$loader" ] && [ ! -e "$loader" ]; then
                echo "[devShell] Missing ELF loader: $loader"
                echo "[devShell] This often happens after a NixOS upgrade or GC when rustup binaries still point at an older glibc path."
              fi
              echo "[devShell] If your base Rust install is broken, first try:"
              echo "[devShell]   rustup toolchain install stable"
              echo "[devShell] Rumoca itself still needs its pinned toolchain, so reinstall that too:"
              echo "[devShell]   rustup toolchain uninstall $toolchain"
              echo "[devShell]   rustup toolchain install $toolchain"
              echo "[devShell]   rustup target add wasm32-unknown-unknown --toolchain $toolchain"
              echo "[devShell]   rustup component add rust-src --toolchain $toolchain"
            }

            check_rumoca_wasm_tooling() {
              local rumoca_root="$(pwd)/packages/rumoca"
              local expected_wasm_bindgen=""
              local expected_wasm_pack="0.13.1"
              local wasm_bindgen_bin=""
              local wasm_pack_bin=""
              local wasm_bindgen_version=""
              local wasm_pack_version=""
              local loader=""

              if [ ! -d "$rumoca_root" ]; then
                return
              fi

              expected_wasm_bindgen="$(
                python - <<'PY' 2>/dev/null
import pathlib, tomllib
lock = tomllib.loads(pathlib.Path("packages/rumoca/Cargo.lock").read_text())
versions = sorted(
    {
        pkg["version"]
        for pkg in lock.get("package", [])
        if pkg.get("name") == "wasm-bindgen"
    }
)
if versions:
    print(versions[-1])
PY
              )"

              wasm_bindgen_bin="$(command -v wasm-bindgen 2>/dev/null || true)"
              if [ -z "$wasm_bindgen_bin" ]; then
                echo "[devShell] wasm-bindgen-cli is missing."
                if [ -n "$expected_wasm_bindgen" ]; then
                  echo "[devShell] Install it with:"
                  echo "[devShell]   cargo install wasm-bindgen-cli --version $expected_wasm_bindgen --locked --force"
                fi
              else
                wasm_bindgen_version="$(wasm-bindgen --version 2>/dev/null | sed -n 's/.* \([0-9][0-9A-Za-z._-]*\)$/\1/p' | head -n 1)"
                if ! wasm-bindgen --version >/dev/null 2>&1; then
                  loader="$(${pkgs.binutils}/bin/readelf -l "$wasm_bindgen_bin" 2>/dev/null | sed -n 's@.*Requesting program interpreter: \(.*\)]@\1@p' | head -n 1)"
                  echo "[devShell] wasm-bindgen-cli exists but is not executable: $wasm_bindgen_bin"
                  if [ -n "$loader" ] && [ ! -e "$loader" ]; then
                    echo "[devShell] Missing ELF loader: $loader"
                    echo "[devShell] This often happens after a NixOS upgrade or GC."
                  fi
                  if [ -n "$expected_wasm_bindgen" ]; then
                    echo "[devShell] Reinstall it with:"
                    echo "[devShell]   cargo install wasm-bindgen-cli --version $expected_wasm_bindgen --locked --force"
                  fi
                elif [ -n "$expected_wasm_bindgen" ] && [ "$wasm_bindgen_version" != "$expected_wasm_bindgen" ]; then
                  echo "[devShell] wasm-bindgen-cli version mismatch: found $wasm_bindgen_version, expected $expected_wasm_bindgen."
                  echo "[devShell] Reinstall it with:"
                  echo "[devShell]   cargo install wasm-bindgen-cli --version $expected_wasm_bindgen --locked --force"
                fi
              fi

              wasm_pack_bin="$(command -v wasm-pack 2>/dev/null || true)"
              if [ -z "$wasm_pack_bin" ]; then
                echo "[devShell] wasm-pack is missing."
                echo "[devShell] Install it with:"
                echo "[devShell]   cargo install wasm-pack --version $expected_wasm_pack --locked --force"
                return
              fi

              wasm_pack_version="$(wasm-pack --version 2>/dev/null | sed -n 's/.* \([0-9][0-9A-Za-z._-]*\)$/\1/p' | head -n 1)"
              if ! wasm-pack --version >/dev/null 2>&1; then
                echo "[devShell] wasm-pack exists but is not executable: $wasm_pack_bin"
                echo "[devShell] Reinstall it with:"
                echo "[devShell]   cargo install wasm-pack --version $expected_wasm_pack --locked --force"
                return
              fi

              if [ "$wasm_pack_version" != "$expected_wasm_pack" ]; then
                echo "[devShell] wasm-pack version mismatch: found $wasm_pack_version, expected $expected_wasm_pack."
                echo "[devShell] Install the expected version with:"
                echo "[devShell]   cargo install wasm-pack --version $expected_wasm_pack --locked --force"
              fi
            }

            check_rumoca_rust_toolchain
            check_rumoca_wasm_tooling

            export LD_LIBRARY_PATH=${pkgs.lib.makeLibraryPath libraries}:$LD_LIBRARY_PATH
            export XDG_DATA_DIRS=${pkgs.gsettings-desktop-schemas}/share/gsettings-schemas/${pkgs.gsettings-desktop-schemas.name}:${pkgs.gtk3}/share/gsettings-schemas/${pkgs.gtk3.name}:$XDG_DATA_DIRS

            # Ensure WebKitGTK/libsoup can load the TLS backend on NixOS.
            export GIO_MODULE_DIR="${pkgs.glib-networking}/lib/gio/modules"
            export GIO_EXTRA_MODULES="${pkgs.glib-networking}/lib/gio/modules''${GIO_EXTRA_MODULES:+:}$GIO_EXTRA_MODULES"

            # Ensure certificate bundle is available for HTTPS validation.
            export SSL_CERT_FILE="${pkgs.cacert}/etc/ssl/certs/ca-bundle.crt"
            export NIX_SSL_CERT_FILE="$SSL_CERT_FILE"


            # ── Corepack cache location ─────────────────────────────────────────────────────
            # By default, Corepack stores downloaded package managers (e.g. Yarn CLI JS) in
            # $COREPACK_HOME. If unset, it uses a global cache outside the repo (e.g. ~/.cache/node/corepack).
            #
            # In our old setup, we forced COREPACK_HOME into ./.corepack/home (inside the repo)
            # so everything was self-contained. However:
            #   • Our repo’s package.json sets `"type": "module"`, so any JS under it is treated as ESM.
            #   • Yarn’s CLI bundle contains `require()` calls, which fail under ESM with:
            #       "Error: Dynamic require of 'util' is not supported"
            #   • This broke Yarn in some projects (notably when package.json was at repo root).
            #
            # Fix: move COREPACK_HOME to a location *outside* any `"type": "module"` package boundary
            #      (e.g. $HOME/.cache/corepack-home) so Node treats Yarn’s CLI as CommonJS.
            #      We still keep shims (yarn, pnpm, etc.) in ./.corepack/bin so they are project-local.
            #
            # Nix note: use ''${...} to pass Bash \$\{...} through without Nix interpolating it.
            ###  ability to use modern yarn
            # Put shims & downloaded package managers inside repo
            # this helps with our new yarn version using corepack on nixos!


            # ── Corepack shims (idempotent & self-healing) ────────────────────────────────
            # Keep Corepack cache outside the repo (CJS-safe),
            # but regenerate repo-local shims when Node/Corepack changes.

            export COREPACK_HOME="''${XDG_CACHE_HOME:-$HOME/.cache}/corepack-home"
            export PATH="$(pwd)/.corepack/bin:$PATH"

            COREPACK_BIN="$(pwd)/.corepack/bin"
            COREPACK_MARKER="$COREPACK_BIN/.node-version"

            mkdir -p "$COREPACK_BIN"

            NODE_VERSION="$(node -v 2>/dev/null || true)"

            if [ ! -f "$COREPACK_MARKER" ] || ! grep -qx "$NODE_VERSION" "$COREPACK_MARKER"; then
              echo "[devShell] Refreshing Corepack shims (node $NODE_VERSION)"

              rm -f \
                "$COREPACK_BIN/yarn" \
                "$COREPACK_BIN/yarnpkg" \
                "$COREPACK_BIN/pnpm" \
                "$COREPACK_BIN/pnpx"

              corepack enable --install-directory="$COREPACK_BIN"
              echo "$NODE_VERSION" > "$COREPACK_MARKER"
            fi
          '';

          # fixes xcb issues :
          # QT_PLUGIN_PATH=${qt5.qtbase}/${qt5.qtbase.qtPluginPrefix}

          # fixes libstdc++ issues and libgl.so issues
          #LD_LIBRARY_PATH=${stdenv.cc.cc.lib}/lib/:/run/opengl-driver/lib/
        };
      }
    );
}
