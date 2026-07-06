# Taskyon Development Guide

Welcome to Taskyon’s development guide. This document will walk you through setting up your environment, understanding key workflows, and contributing effectively to our codebase. Whether you’re exploring Taskyon for the first time or joining an ongoing project, these steps and explanations will help you make meaningful contributions faster.

---

## Prerequisites & Versions

Taskyon requires a development environment with **Node.js** and **Yarn** (and optionally Rust/Docker for desktop builds). Contributors are free to use any OS or setup they prefer:

- If you use **Nix flakes**, versions are already pinned in `flake.nix`—you can run `nix develop` to enter the correct shell.
- Otherwise, install Node.js (>=16.x) and Yarn (>=1.22.x) directly on your system. You can consult `flake.nix` for the exact versions we use if needed.
- Quasar and Vue are pulled in via dev-dependencies—no global CLI install required; prefix commands with `yarn`.
- For **Tauri** desktop builds, we recommend the Docker-based approach using `Dockerfile.tauri`.

> _Note:_ The flake is there for those familiar with Nix; everyone else can just ensure they have Node/Yarn installed and proceed.

---

## Install the Project

Follow these steps to clone and prepare Taskyon on your local machine:

1. **Clone the repository**

   ```bash
   git clone https://github.com/Xyntopia/taskyon.git
   cd taskyon
   ```

2. **Install JavaScript dependencies**

   ```bash
   yarn install
   yarn quasar prepare   # sets up TypeScript definitions
   ```

3. **Run the dev server**

   ```bash
   yarn quasar dev
   ```

   The application will be available at `http://localhost:9000`.

4. **Build for production**

   ```bash
   yarn quasar build
   ```

   Output is placed in the `dist/` directory.

> _Tip:_ If you ever upgrade dependencies in `flake.nix`, run `nix flake update` to refresh pins.

---

## NPM / Yarn Scripts

We expose common workflows as npm scripts. Below is each command with its purpose:

```json
{
  "scripts": {
    "build": "yarn build:lib && yarn build:app",
    "build:lib": "yarn run vite build --config vite.lib.config.ts",
    "build:app": "yarn run quasar build",
    "build:desktop": "docker build --file Dockerfile.tauri --target export --output type=local,dest=./dist-desktop .",
    "dev": "yarn run quasar dev",
    "format": "prettier --write \"**/*.{js,ts,vue,html,md,json}\" --ignore-path .gitignore",
    "lint": "vue-tsc --noEmit && eslint -c ./eslint.config.js './src*/**/*.{ts,js,vue}'"
  }
}
```

- **`build`**: Runs library bundling (for npm publication) and application packaging in sequence.
- **`build:lib`**: Uses Vite to produce a standalone Taskyon core library (`esm` & `cjs`).
- **`build:app`**: Invokes Quasar to compile the SPA for production.
- **`build:desktop`**: Builds the Tauri desktop binary inside Docker; output lands in `./dist-desktop`.
- **`dev`**: Launches Quasar’s hot-reload dev server.
- **`format`**: Auto-formats all supported files via Prettier.
- **`format:file`**: Formats only the specific files you pass, using the same repository Prettier configuration.
- **`lint`**: Runs TypeScript type checks (no emit) and ESLint against your code.

> _Pro tip:_ Run `yarn lint:fix` to auto-fix ESLint errors (if enabled in your editor).

---

## Configuration & Local‑First Architecture

Taskyon is designed as a **local‑first** application: all data lives securely in the browser, eliminating the need for external API keys or environment variables.

- **Settings UI**: Visit `http://localhost:9000/settings/sync` to create, save, and switch between named configurations (e.g., development, staging, production).
- **Password Manager**: API credentials (if added in the future) are stored using the built‑in password manager, ensuring encryption at rest.

> _Why local-first?_ You can prototype features offline, avoid backend dependencies, and protect sensitive data by default.

---

## Building & Publishing Documentation

Documentation lives alongside the project code:

1. **Markdown docs**: Place guides or API references in `src/public/doc`. The build pipeline automatically inlines these under `/docs/`.
2. **Iframe API Reference**: On each build, Taskyon fetches and compiles the OpenAPI spec at:

   ````
   https://rest.wiki/https://taskyon.space/docs/openapi-docs.yml
   ```s
   ````

> _Best practice:_ Keep documentation and examples updated whenever you change public APIs.

---

### Taskyon Clients

It is possible to include taskyon as an iframe and "talk" to it this way. This is a very easy
way to enhance your app or webpage with AI functionality. For more information check out this doc:

[taskyon integration](./docs/taskyon_integration)

Additionally, we encourage to write code examples for taskyon client using typescript. Check out the
"tyClientExamples" directory for this. It includes a taskyon client library in public/lib which
you can build using

```
yarn build:lib
```

If you have a typescript project, you can include this library as well as we provide the necessary types for it!

---

## Dependency Analysis

Taskyon’s codebase is structured to maintain a clear separation between the **Quasar framework** and **Taskyon’s core logic**. This not only ensures modularity but also helps prevent circular dependencies within the project. Analyzing dependencies is crucial, and we provide two tools for this purpose:

- **Dependency Cruiser** (preferred, as it supports Vue files):

Here is one example of the structure of taskyons codebase as an interactive html:

[dependency-cruiser-graph-flat-dot.html](/docs/draft/dependency-cruiser-graph-flat-dot.html)

```bash
# perform dependency analysis e.g. in order to detect circular dependencies:
depcruise src

# generate a simple visual graph:
depcruise src --include-only "^src" --output-type dot | dot -T svg > dependency-graph.svg

# generate folder level interactive overview:
depcruise src --config --output-type ddot |   dot -T svg -Grankdir=TD |   tee dependency-cruiser-dir-graph.svg | depcruise-wrap-stream-in-html > dependency-cruiser-dir-graph.html

# get a nice interactive overview of our dependencies without folder groups
depcruise src --progress \
#    --output-type flat \
    --include-only "^src" \
  | dot -Tsvg \
  | tee dependency-cruiser-graph-flat-dot.svg \
  | npx depcruise-wrap-stream-in-html \
  > dependency-cruiser-graph-flat-dot.html

# leave out some files which are used all over the place to clean up the graph:
depcruise src --progress \
  --output-type flat \
  --include-only "^src" \
  --exclude "(types\.ts|utils\.ts)" \
  | dot -Tsvg \
  | tee dependency-cruiser-graph-flat-dot.svg \
  | npx depcruise-wrap-stream-in-html \
  > dependency-cruiser-graph-flat-dot.html
```

- **Madge** (useful, but currently has issues detecting Vue file references):

```bash
madge  --image graph.svg ./src
#or
madge --circular --image graph.svg ./src
```

This analysis helps maintain a clean structure as Taskyon grows and evolves.

---

## Testing & Diagnostics

## Modelica: Compare + OMC Traces

`modelica:compare` compares the JS solver against OMC traces. It now runs from:

```bash
yarn run modelica:compare run --help
```

Run with defaults (auto-ensures MSL zip in the default location):

```bash
yarn run modelica:compare run
```

Typical single-model run:

```bash
yarn run modelica:compare run \
  --model Modelica.Electrical.Analog.Examples.ChuaCircuit \
  --json
```

To generate OMC simulation references + trace JSON files for the MSL target set:

```bash
bash ./packages/modelica/scripts/generate-omc-traces-via-podman.sh
```

Notes:

- Requires `podman`, `cargo`, and `curl`.
- Uses `OMC_PODMAN_IMAGE` (default `openmodelica/openmodelica:v1.26.1-gui`).
- Output traces are written to `packages/rumoca/target/msl/results/sim_traces/omc`.

### End-to-End (E2E) with Cypress

- **Run headless**:

  ```bash
  cypress run --e2e
  ```

- **Open interactive UI**:

  ```bash
  yarn cypress open --e2e
  ```

- **Video recordings**: Stored in `test/cypress/videos/` for post-mortem.

All E2E tests must pass before merging feature branches.

### In‑Browser Unit Tests & Diagnostics

Navigate to `http://localhost:9000/diagnostics` while the dev server is running. This page exposes unit tests and performance metrics in a live console.

> _Tip:_ Write unit tests for core logic under `src/core/` and expose them via the diagnostics UI for quick feedback.

The diagnostics UI supports:

- running all registered diagnostics tests,
- filtering tests by substring,
- aborting currently running tests with the **Abort** button,
- downloading/copying the generated YAML report.

### Headless Tauri Diagnostics

For CI-style diagnostics without a Quasar dev server:

```bash
yarn tauri:dev:diagnostics
```

This performs a fast debug frontend build first (`build:app:diagnostics`) and then starts Tauri headless diagnostics.

For local iteration with an already-running dev server:

```bash
yarn tauri:dev:diagnostics:devserver
# or
yarn tauri:dev:diagnostics:devserver:https
```

On Linux servers/CI without a desktop session, use the `:xvfb` variants:

```bash
yarn tauri:dev:diagnostics:devserver:xvfb
yarn tauri:dev:diagnostics:devserver:all-logs:xvfb
```

(`:xvfb` scripts use `scripts/run-with-xvfb.sh`, which prefers `xvfb-run` when available and falls back to direct `Xvfb`.)

For non-diagnostics headless mode:

```bash
yarn tauri:dev:headless:xvfb
yarn tauri:dev:headless:all-logs:xvfb
```

Headless diagnostics capabilities:

- default test-centric log output (mostly `[HEADLESS][TEST]`, warnings/errors, and final result markers),
- explicit keep-tags for important diagnostics lines (for example failed tests are logged as `[HEADLESS][KEEP][TEST][FAIL] ...`),
- test filtering via `--test-filter "<text>"` (case-insensitive, whitespace-insensitive substring match),
- machine-readable result marker: `HEADLESS_DIAGNOSTICS_RESULT ...`,
- full diagnostics YAML emitted between `HEADLESS_DIAGNOSTICS_YAML_START` and `HEADLESS_DIAGNOSTICS_YAML_END`.

Run only one diagnostics test (example):

```bash
yarn tauri:dev:diagnostics:devserver -- --test-filter "indexed db key storage"
```

Log policy defaults by mode:

- diagnostics mode: only explicitly tagged keep-lines (`[HEADLESS][KEEP]`) plus warnings/errors,
- headless server mode (non-diagnostics): only explicitly tagged keep-lines (`[HEADLESS][KEEP]`) plus warnings/errors,
- warnings/errors are always printed.

To bypass tag filtering and print all forwarded headless logs, pass:

```bash
tauri dev -c src-tauri/tauri.diagnostics.conf.json --no-watch -- -- --headless --run-diagnostics --all-logs
```

Alias: `--diagnostics-all-logs`.

---

## Branching & Preview Deployments

Our Git workflow follows a simple model:

1. **Feature branches** off `dev` (e.g., `feature/task-sorting`).
2. **Pull requests** merge back into `dev`.
3. **Continuous preview**: Successful merges trigger an auto-deploy of `dev` to:

   ```
   https://dev.taskyon.space
   ```

4. **Stabilization branch** (optional) before cutting a formal release tag.

> _Why this model?_ It keeps `main` or `dev` always deployable and supports rapid iteration.

---

## Desktop App with Tauri

To build a cross-platform desktop binary:

1. Ensure Docker is running.
2. At the repo root, execute:

   ```bash
   yarn build:desktop
   ```

3. The built application bundle will be in `dist-desktop/`.

This Docker-based approach abstracts away Rust toolchain setup, ensuring a reproducible build.

---

## Docker & Docker Compose

At the project root you’ll find:

- **`Dockerfile`**: Builds a containerized web server for Taskyon.
- **`Dockerfile.tauri`**: Builds the Tauri desktop exporter.
- **`docker-compose.yml`** (if present): Defines multi-container setups (e.g., with mock backends).

To start via Docker Compose:

```bash
docker-compose up --build
```

This spins up Taskyon and any auxiliary services defined in your compose file.

---

## Code Formatting & Linting

Consistency is enforced through:

- **Prettier** (configured in `prettier.config.js`)
- **ESLint** (rules in `eslint.config.js`)
- **TypeScript checks** (via `vue-tsc`)

**Commands**:

```bash
yarn format:file src/example.ts src/example.vue   # format only changed files
yarn lint                                      # type-checks & lints
```

Format only the files you changed, and lint before committing to keep diffs clean.

Make sure your code is correctly formatted and linted before committing. The configuration for ESLint is integrated into the project, and Visual Studio Code will help ensure that your contributions align with the coding standards (e.g. you can press
ctrl-shift-p then search for "format" and it will give formatting options).

In VS Code, we use "prettier" for all formatting options...

---

## Nix Flake

Taskyon provides a Nix flake (flake.nix) as a development environment which can be used to provide a consistent development environment for taskyon.

## Debugging

To debug Taskyon, we recommend using **Vue DevTools**, which integrates seamlessly with the development environment. You can inspect components, monitor pinia states, and track changes in real time, ensuring efficient debugging and development workflows.

### Remote Debugging

#### vue

you can start vue devtools using:

```
vue-devtools
```

browsers should automatically connect to it

## Contribution Guidelines

We welcome contributions of all sizes:

- **Reporting issues**: Use GitHub Issues at [https://github.com/Xyntopia/taskyon/issues](https://github.com/Xyntopia/taskyon/issues)
- **Proposing changes**: Fork the repo, create a branch off `dev`, and open a PR. Include:
  - A clear description of your change
  - Screenshots or recordings (if UI-related)
  - Passing lint and test checks

Please adhere to our commit message format:

```
[type]: brief description

More detailed context, if necessary.
```

Where `type` is one of `feat`, `fix`, `docs`, `chore`, or `test`.

Thank you for helping make Taskyon better—your contributions drive our community forward!
