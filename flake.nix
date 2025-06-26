{
  description = "Nix Development Flake for Quasar";

  inputs = {
    flake-utils.url = "github:numtide/flake-utils";
    nixpkgs_unstable.url = "github:NixOS/nixpkgs/nixos-unstable";
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-24.11";
  };

  outputs = { self, nixpkgs, nixpkgs_unstable, flake-utils }:

    flake-utils.lib.eachDefaultSystem (system:
      let
        # https://nixos.wiki/wiki/Rust
        # https://nixos.org/manual/nixpkgs/stable/#rust
        # if we want a specific rust version:
        # rust-overlay.url = "github:oxalica/rust-overlay";
        pkgs = import nixpkgs { inherit system; };
        pkgs_unstable = import nixpkgs_unstable { inherit system; };
        python = pkgs.python310;

        # this is all tauri-related stuff
        libraries = with pkgs; [

          # tauri deps
          at-spi2-atk
          atkmm
          cairo
          gdk-pixbuf
          glib
          gobject-introspection
          gobject-introspection.dev
          gtk3
          harfbuzz
          librsvg
          libsoup_3
          pango
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
          rustup

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
          xorg.libX11
          xorg.libXcomposite
          xorg.libXdamage
          xorg.libXext
          xorg.libXfixes
          xorg.libXrandr
          xorg.libxcb
          libxkbcommon
          #xorg
          mesa # for libgbm
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

          # for running local llm models:
          # not sure, why..  but this isn't working, currently.. so we are using docker
          # local-ai

          # node
          yarn
          nodejs_22

          # helpers
          graphviz # we are using this with "madge" in order to display dependency graphs...

          # supabase
          docker-compose
          # colima # also doesn't work yet somehow...
          # podman # doesn't work with supabase I think
          pkgs_unstable.stripe-cli

          pkgs_unstable.deno

          python # this is needed for newer quasar versions apparently...

          kdiff3
        ];
      in {
        devShells.default = pkgs.mkShell rec {
          pure  = true;                   # ← turn on “pure” mode
          name = "xyntopia_gui";
          # TODO: what is this for? nativeBuildInputs = [ pkgs.bashInteractive ];
          buildInputs = packages;
          # the following comes from here: https://tauri.app/start/prerequisites/
          # but by declaring LD_LIBRARY_PATH we might have done it correctly already ;)
          # and thats why we're commenting it out...
          #PKG_CONFIG_PATH = "${glib.dev}/lib/pkgconfig:${libsoup_3.dev}/lib/pkgconfig:${webkitgtk_4_1.dev}/lib/pkgconfig:${at-spi2-atk.dev}/lib/pkgconfig:${gtk3.dev}/lib/pkgconfig:${gdk-pixbuf.dev}/lib/pkgconfig:${cairo.dev}/lib/pkgconfig:${pango.dev}/lib/pkgconfig:${harfbuzz.dev}/lib/pkgconfig";
          propagatedBuildInputs = libraries;  # your GTK/WebKit/etc libs
          
          shellHook = ''
            # python poetry related stuff
            unset SOURCE_DATE_EPOCH
            unset LD_PRELOAD

            export NODE_OPTIONS="--max-old-space-size=8192"
            echo "increasing node memory allocation to $NODE_OPTIONS"


            if [ -f ./.env ]; then
              set -a  # automatically export all variables
              source ./.env
              set +a
            fi

            export PATH="$(pwd)/node_modules/.bin:$PATH"

            export XDG_DATA_DIRS=${pkgs.gsettings-desktop-schemas}/share/gsettings-schemas/${pkgs.gsettings-desktop-schemas.name}:${pkgs.gtk3}/share/gsettings-schemas/${pkgs.gtk3.name}:$XDG_DATA_DIRS
          '';
          # fixes xcb issues :
          # QT_PLUGIN_PATH=${qt5.qtbase}/${qt5.qtbase.qtPluginPrefix}

          # fixes libstdc++ issues and libgl.so issues
          #LD_LIBRARY_PATH=${stdenv.cc.cc.lib}/lib/:/run/opengl-driver/lib/
        };
      });
}
