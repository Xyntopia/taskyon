{
  description = "Nix Development Flake for Quasar";
  #inputs.nixpkgs.url = "github:NixOS/nixpkgs/master";

  inputs = {
    flake-utils.url = "github:numtide/flake-utils";
    #nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-23.11";
    # we can not use poetry2nix right now, because we're getting infinite recursion errors.
    # I suspect, the reason for this is, that one of our dependencies uses a package
    # which is also included in the nix poetry package...
    /* poetry2nix = {
         url = "github:nix-community/poetry2nix";
         inputs.nixpkgs.follows = "nixpkgs";
       };
    */
    #https://www.reddit.com/r/NixOS/comments/11xgby8/python_and_flake_infinite_recursion/
  };

  outputs = { self, nixpkgs, flake-utils }:

    flake-utils.lib.eachDefaultSystem (system:
      let
        # https://nixos.wiki/wiki/Rust
        # https://nixos.org/manual/nixpkgs/stable/#rust
        # if we want a specific rust version:
        # rust-overlay.url = "github:oxalica/rust-overlay";
        pkgs = import nixpkgs { inherit system; };
        python = pkgs.python310;
        #pythonPackages = python.pkgs;

        # this is all tauri-related stuff
        libraries = with pkgs; [

          # tauri deps
          webkitgtk
          gtk3
          cairo
          gdk-pixbuf
          glib
          dbus
          openssl_3
          librsvg
          libsoup

          # this is needed for appimage by build_appimage.sh ...
          libgpg-error 
          xorg.libX11
          xorg.libSM
          xorg.libICE
          xorg.libxcb
          fribidi
          fontconfig
          libthai
          harfbuzz
          freetype
          libglvnd
          mesa
          libdrm
        ];
        packages = with pkgs; [
          # rust
          rustfmt
          #clippy
          rustc
          cargo
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

          # node
          yarn
          nodejs_21
        ];
      in {
        devShells.default = pkgs.mkShell rec {
          name = "xyntopia_gui";
          # TODO: what is this for? nativeBuildInputs = [ pkgs.bashInteractive ];
          buildInputs = libraries ++ packages;
          shellHook = ''
            # Environment variables
            # fixes libstdc++ issues, libz.so.1 issues
            # export LD_LIBRARY_PATH="${pkgs.stdenv.cc.cc.lib}/lib/:${
              pkgs.lib.makeLibraryPath buildInputs
            }";

            #PYTHONPATH=$PWD/$venvDir/${python.sitePackages}:$PYTHONPATH

            if [ -f ./.env ]; then
              set -a  # automatically export all variables
              source ./.env
              set +a
            fi

            export PATH="$(pwd)/node_modules/.bin:$PATH"

            export LD_LIBRARY_PATH=${
              pkgs.lib.makeLibraryPath libraries
            }:$LD_LIBRARY_PATH
            export XDG_DATA_DIRS=${pkgs.gsettings-desktop-schemas}/share/gsettings-schemas/${pkgs.gsettings-desktop-schemas.name}:${pkgs.gtk3}/share/gsettings-schemas/${pkgs.gtk3.name}:$XDG_DATA_DIRS
          '';
          # fixes xcb issues :
          #QT_PLUGIN_PATH=${qt5.qtbase}/${qt5.qtbase.qtPluginPrefix}

          # fixes libstdc++ issues and libgl.so issues
          #LD_LIBRARY_PATH=${stdenv.cc.cc.lib}/lib/:/run/opengl-driver/lib/
          #export LD_LIBRARY_PATH="$(nix eval --raw nixpkgs.zlib)/lib${LD_LIBRARY_PATH:+:}${LD_LIBRARY_PATH}"
        };
      });
}
