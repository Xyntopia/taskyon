# Development Setup

Taskyon is a Yarn 4 monorepo. Use Node.js 22.22 or newer.

```bash
yarn install
yarn dev
```

The application runs at `https://localhost:9000` when that port is available. Quasar prints the
actual HTTPS URL if it selects another port. The local CORS proxy selects a free loopback port
automatically; set `TASKYON_CORS_PROXY_PORT` only when a fixed proxy port is needed.
`yarn dev:http` enables the explicit HTTP development mode.

## Browser compatibility

The `browserslist` setting in `package.json` targets `cover 95.5%`, `last 2 versions`,
and `not dead`. As of 2026-10-24 this corresponds to approximately 95.4% of global
browser usage (`yarn browserslist --coverage`). Autoprefixer adds any CSS vendor
prefixes needed by these targets; `yarn test:postcss` checks the coverage threshold
and CSS transformation.

Browserslist is a **CSS compatibility target**, not a guarantee that every selected
browser can run Taskyon. Vite 8's default production JavaScript target is Baseline
Widely Available (Chrome/Edge 111+, Firefox 114+, Safari/iOS 16.4+), while Taskyon
also requires runtime capabilities such as WebAssembly, workers, and browser storage.
Supporting older browsers end to end would require checking those capabilities,
adjusting the JS build or polyfills when appropriate, and testing the affected browsers.

## Nix and non-Nix development

**Nix is optional.** Taskyon must build on Ubuntu or another supported Linux system
without installing Nix. Both setups use the same Yarn and Cargo build scripts.

With Nix, enter the frontend directory and run:

```bash
nix develop
yarn install
yarn dev
```

The flake supplies a pinned Rust compiler and the `wasm32-unknown-unknown` target
through Fenix, plus the matching `wasm-bindgen-cli` from the HTTPS tunnel's
`Cargo.lock`. No `prepare_rust` command or `cargo install` is needed inside
the Nix shell. `nix develop .#wasm` is an alias of the default shell, retained
for existing direnv configurations that use `use flake .#wasm`. Yarn is supplied
by a Nix-store wrapper around Corepack, which selects the version pinned in
`package.json`; it does not require working symlinks in `.corepack/bin`.

On Ubuntu **without Nix**, install Node.js 22.22+ and enable Corepack,
then initialize the Rust tooling with rustup:

```bash
sudo apt-get install build-essential pkg-config \
  libssl-dev curl python3
rustup toolchain install 1.95.0
rustup target add wasm32-unknown-unknown \
  --toolchain 1.95.0
cargo +1.95.0 install wasm-bindgen-cli \
  --version 0.2.108 --locked
corepack enable
yarn install
yarn dev
```

Install `rustup` from the [official Rust installation instructions](https://rustup.rs/)
if it is not already present. The repository's `rust-toolchain.toml` pins Rust
for both rustup and Fenix; the required `wasm-bindgen-cli` version matches
`packages/https_tunnel_wasm/Cargo.lock`. If either changes, update this setup
guide and the non-Nix Docker build accordingly.

Rumoca is a separate Rust project with its own pinned nightly toolchain and
flake. Enter `packages/rumoca` and use its own `nix develop` or rustup
setup when working on Rumoca directly; Taskyon's stable frontend shell should
not override Rumoca's compiler.

No global Quasar installation is required. Outside the Nix shell, keep
`COREPACK_HOME` outside the repository if Corepack resolves through a package
directory marked as ESM.

## Common commands

```bash
yarn build
yarn test:e2e
yarn tycli
yarn tycli:typecheck
yarn modelica:compare
yarn tauri:dev
yarn docs:check
yarn links:check
```

`yarn docs:check` validates documentation manifest coverage and links. `yarn links:check` checks
statically recognizable application links. Runtime FRP, tool, and API documentation is generated
by the running peer and is not emitted as Markdown during the build.

Format only edited files:

```bash
yarn format:file path/to/file.ts path/to/page.vue
```

Read `AGENTS.md` before changing code. It contains the general programming guardrails and routes
specialized work to focused policies under `policies/`.

## Debugging

Use the browser developer tools and Vue DevTools for normal frontend inspection. Development builds
also support remote browser inspection through a Chii target: add `?chii=1` to the application URL
or set `localStorage['taskyon.enableChii']` to `1`. This optional path expects a separately managed
Chii server on HTTPS port `8090`.

## Repository structure

The root application is Quasar/Vue. Reusable runtime and UI code lives in `packages/`. Browser and
Node behavior share Taskyon core, while runtime-specific capabilities are registered at their host
boundaries.

Important package owners include:

- `packages/taskyon`: task engine, protocols, tools, and model orchestration;
- `packages/common`: runtime-neutral infrastructure and diagnostics;
- `packages/ui`: reusable Taskyon-owned Vue/Quasar UI;
- `packages/tyclient`: published iframe client;
- `packages/tycli`: Node CLI and Node diagnostics;
- `packages/p2p-core` and `packages/relay`: libp2p networking;
- `packages/modelica`: Modelica UI, runtime, templates, and comparison tooling;
- `packages/rumoca` and `packages/yatra`: separate repositories with separate workflows.

## Development policy

The concise [Taskyon Core Policies](core-policies.md) are the canonical project
philosophy for human contributors and AI agents. `AGENTS.md` adds agent-specific operating rules and
routes specialized work to focused guardrails under `policies/`.

## Dependency inspection

Dependency Cruiser understands the TypeScript/Vue project:

```bash
yarn run depcruise src --include-only '^src' --output-type dot | dot -Tsvg > dependency-graph.svg
yarn run depcruise src --validate
```

The repository also includes Madge for focused JavaScript/TypeScript checks, but it is less reliable
for Vue single-file component resolution. Generated dependency graphs are disposable artifacts and
should not be kept as documentation snapshots.

## Builds and runtime targets

- `yarn build` validates documentation and application links, builds generated workspace packages,
  regenerates the published client, and builds the Quasar app. `yarn build:app` builds the workspace
  packages and tunnel WASM, then runs type checking, ESLint, and Playwright test discovery before
  bundling. The container build runs these checks in the same order.
- `yarn build:desktop` exports the containerized desktop build.
- `yarn tauri:build` uses the local Tauri toolchain.
- `podman compose up --build` starts the services defined by `docker-compose.yml`.
- `yarn relay` builds and starts the Taskyon relay.

Builds need enough memory for Quasar and package generation. The Nix shell configures the expected
Node heap; outside it, set `NODE_OPTIONS=--max-old-space-size=8192` when required. Keep the
protocol package and app on one resolved Zod version because schema types cross that boundary;
two versions can greatly increase `vue-tsc` memory use. Run `vue-tsc --noEmit` separately from a
production bundle when investigating memory pressure.

## Branches and contributions

`dev` is the open-source integration branch. The `taskyon` branch tracks the public application
line. Create focused branches from the appropriate integration branch, preserve unrelated worktree
changes, and include the checks relevant to the changed ownership boundary.

Use the repository's existing commit conventions (`feat`, `fix`, `docs`, `chore`, or `test`) when
preparing a contribution. UI changes should include visual evidence; behavior changes should
include focused diagnostics or tests.
