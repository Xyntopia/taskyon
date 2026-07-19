# Development Setup

Taskyon is a Yarn 4 monorepo. Use Node.js 20 or newer.

```bash
yarn install
yarn dev
```

The application runs at `http://localhost:9000` by default. `yarn dev:http` enables the explicit
HTTP development mode.

The Nix flake pins Node, Yarn/Corepack, Rust, and supporting tools:

```bash
nix develop
```

No global Quasar installation is required. Outside the Nix shell, keep `COREPACK_HOME` outside the
repository if Corepack resolves through a package directory marked as ESM.

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

- `yarn build` validates documentation and application links, regenerates the published client, and
  then builds the Quasar app.
- `yarn build:desktop` exports the containerized desktop build.
- `yarn tauri:build` uses the local Tauri toolchain.
- `docker compose up --build` starts the services defined by `docker-compose.yml`.
- `yarn relay` builds and starts the Taskyon relay.

Builds need enough memory for Quasar and package generation. The Nix shell configures the expected
Node heap; outside it, set `NODE_OPTIONS=--max-old-space-size=8192` when required.

## Branches and contributions

`dev` is the open-source integration branch. The `taskyon` branch tracks the public application
line. Create focused branches from the appropriate integration branch, preserve unrelated worktree
changes, and include the checks relevant to the changed ownership boundary.

Use the repository's existing commit conventions (`feat`, `fix`, `docs`, `chore`, or `test`) when
preparing a contribution. UI changes should include visual evidence; behavior changes should
include focused diagnostics or tests.
