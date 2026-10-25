{
  description = "Nix Development Flake for Quasar";

  inputs = {
    flake-utils.url = "github:numtide/flake-utils";
    nixpkgs_unstable.url = "github:NixOS/nixpkgs/nixos-unstable";
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-26.05";
    fenix = {
      url = "github:nix-community/fenix";
      inputs.nixpkgs.follows = "nixpkgs";
    };
  };

  outputs =
    {
      self,
      nixpkgs,
      nixpkgs_unstable,
      flake-utils,
      fenix,
    }:

    flake-utils.lib.eachDefaultSystem (
      system:
      let
        pkgs = import nixpkgs { inherit system; };
        pkgs_unstable = import nixpkgs_unstable { inherit system; };
        python = pkgs.python311;
        # Fenix and rustup share one stable toolchain pin, separate from Rumoca's nightly.
        rustToolchain = fenix.packages.${system}.fromToolchainFile {
          file = ./rust-toolchain.toml;
          sha256 = "sha256-gh/xTkxKHL4eiRXzWv8KP7vfjSk61Iq48x47BEDFgfk=";
        };
        # Bindgen CLI must match the crate recorded in the tunnel Cargo.lock.
        wasmBindgenVersion =
          let
            lock = builtins.fromTOML (builtins.readFile ./packages/https_tunnel_wasm/Cargo.lock);
            bindings = builtins.filter (package: package.name == "wasm-bindgen") lock.package;
          in
          (builtins.head bindings).version;
        wasmBindgenSource = pkgs.fetchCrate {
          pname = "wasm-bindgen-cli";
          version = wasmBindgenVersion;
          hash = "sha256-UsuxILm1G6PkmVw0I/JF12CRltAfCJQFOaT4hFwvR8E=";
        };
        wasmBindgenCli = pkgs.buildWasmBindgenCli {
          src = wasmBindgenSource;
          cargoDeps = pkgs.rustPlatform.fetchCargoVendor {
            src = wasmBindgenSource;
            pname = "wasm-bindgen-cli";
            version = wasmBindgenVersion;
            hash = "sha256-iqQiWbsKlLBiJFeqIYiXo3cqxGLSjNM8SOWXGM9u43E=";
          };
        };
        # Corepack selects the Yarn version pinned by package.json. Supply a
        # store-backed executable so direnv never depends on local .corepack shims.
        yarnBin = pkgs.writeShellScriptBin "yarn" ''
          exec ${pkgs.nodejs_22}/bin/corepack yarn "$@"
        '';
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
          # Fenix provides Rust inside Nix; rustup is for non-Nix environments.
          # add rust toolchain
          rustc
          rustfmt # needed in order to compile rumoca
          cargo

          # for browser e2e testing
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
          lld # linker for https_tunnel_wasm
          rustToolchain
          wasmBindgenCli
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
          yarnBin

          # helpers
          graphviz # we are using this with "madge" in order to display dependency graphs...
          perf # needed for cargo flamegraph (perf-based sampling)
          xorgserver # provides Xvfb / xvfb-run for headless tauri diagnostics on servers
          dbus # session bus for scripts/run-with-headless-keyring.sh
          gnome-keyring # unlocked Secret Service for headless tauri diagnostics on servers

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
        ];
      in
      {
        packages.wasm-bindgen-cli = wasmBindgenCli;
        devShells = rec {
          default = pkgs.mkShell rec {
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

                        # Do not let the host's rustup toolchain override pinned Fenix.
                        export PATH="${rustToolchain}/bin:$(pwd)/node_modules/.bin:$PATH"


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

                        # Always prefer the Nix-provided yarn over mutable project-local shims.
                        export PATH="${yarnBin}/bin:$PATH"
          '';

          # fixes xcb issues :
          # QT_PLUGIN_PATH=${qt5.qtbase}/${qt5.qtbase.qtPluginPrefix}

          # fixes libstdc++ issues and libgl.so issues
          #LD_LIBRARY_PATH=${stdenv.cc.cc.lib}/lib/:/run/opengl-driver/lib/
          };
          # Backward compatible with existing direnv `use flake .#wasm` configs.
          # Default already includes the pinned Rust WASM target and wasm-bindgen CLI.
          wasm = default;
        };
      }
    );
}
