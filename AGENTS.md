# Agent Instructions

## Required reading before code changes

- `development_instructions.md` — typing, lint, and root-cause rules (mandatory).
- `packages/shared/modelica/README.md` — before any Modelica compiler, template, runtime, or simulation change.
- `packages/rumoca/AGENTS.md` — before any rumoca change (separate submodule with own spec system).

## Key rules

- Fix root causes: keep values strongly typed at their source. No `as any`, `as unknown as`, JSON round-trip hacks, or widening types to silence errors.
- If a fix starts cascading into broad type churn, readonly workarounds, or many unrelated file edits, stop and step back. Revert the speculative path and choose the smallest boundary fix instead of spreading the workaround through the codebase.
- No generic `isRecord`-style guards. Narrow at the domain boundary, then pass typed values downstream.
- No fake no-op implementations. Model unavailable capabilities as optional.
- Before creating or refactoring a tool, first search for similar tools in `packages/taskyon/src/tools/` and inspect how they are implemented. Reuse local patterns like `makeTaskResult`, `toolCall`, `chatCompletion`, and re-entry chains instead of inventing a new orchestration style.
- Do not auto-run `yarn lint` or `yarn lint:fix` (neither repo-wide nor targeted) unless the user explicitly asks. Linting is intentionally not default because it is comparatively expensive. Instead, remind the user to run `yarn lint` themselves before committing, or ask whether they want you to run it when wrapping up. Targeted `yarn eslint <path>` is fine only when needed to verify a specific change and only when explicitly requested.
- Always run the formatter on every file you edited yourself, without waiting for the user to ask. Format only the edited files: `yarn format:file <path...>`
- When adding a test, make sure it is part of the diagnostics suite. Prefer locations already discovered by `packages/taskyon-headless` (for example `packages/taskyon/src/tests/test*.ts`) or wire the new test into the appropriate diagnostics runner.
- Prefer explicit event/function flow over Vue watchers. Watchers are hard to trace and should be used only when reacting to external reactive state is genuinely the simplest boundary; do not use a watcher to bounce one source of truth into another.

## TypeScript readability

- Optimize TypeScript for local readability first, then reuse. Strong types are
  required, but do not split every tiny local concept into top-level aliases just
  to make the type graph look tidy.
- Use separate named types when the name carries domain meaning, the type is
  reused, it is a public API boundary, or it is complex enough that naming makes
  the code easier to read.
- Prefer inline unions or a single nearby options type for small local details.
  Avoid extra aliases such as one-off mode unions, one-off legacy arg wrappers,
  or types that merely mirror part of another type without adding meaning.
- Keep types close to the code that uses them. Do not create a broad shared
  "normalized type universe" for implementation details.
- For APIs with multiple strategies, prefer an explicit required `mode` or
  `method` field when callers must choose behavior, and implement the branch with
  a simple `switch` statement.
- Do not merge unrelated controls into one parameter. For example, a traversal
  limit such as `maxFollow` should stay separate from an options object that
  selects the traversal strategy.

## Coding principles

- Prefer functional style and composition, but keep the code readable. Avoid
  unnecessary nesting, clever abstractions, and indirection that makes the
  control flow harder to follow.
- Keep functions focused on one purpose. Around 40 lines is a useful guideline:
  if a function becomes harder to read, split it by responsibility.
- Extract helpers when they remove real duplication or clarify a distinct step.
  Do not extract helpers only to make code look abstract.

## Branches

- `dev` is the open-source integration branch. Backport general Taskyon fixes here only when they do not depend on commercial services or taskyon.space-specific files.
- `taskyon` is also open source and tracks the public Taskyon app line.

## Commands

| Task                      | Command                                                          |
| ------------------------- | ---------------------------------------------------------------- |
| Install                   | `yarn install` (Yarn 4 via Corepack; `nodeLinker: node-modules`) |
| Dev server                | `yarn dev`                                                       |
| HTTP dev server           | `yarn dev:http`                                                  |
| Full build                | `yarn build` (pack:tyclient → quasar build)                      |
| Lint (typecheck + eslint) | `yarn lint`                                                      |
| Lint fix (targeted)       | `yarn lint:fix -- <path...>`                                     |
| Format file               | `yarn format:file <path...>`                                     |
| tycli dev                 | `yarn tycli`                                                     |
| tycli build               | `yarn tycli:build`                                               |
| tycli lint / typecheck    | `yarn tycli:lint` / `yarn tycli:typecheck`                       |
| tycli e2e                 | `yarn workspace @taskyon/tycli test:e2e`                         |
| Tauri desktop dev         | `yarn tauri:dev`                                                 |
| Modelica CLI              | `yarn modelica:cli`                                              |
| Modelica compare          | `yarn modelica:compare`                                          |
| Modelica baseline diff    | `yarn modelica:baseline:diff`                                    |
| Cypress e2e               | `yarn quasar test:e2e:cypress` (or via Quasar CLI)               |

## Architecture

- **Monorepo**: Yarn 4 workspaces. Root `package.json` is the Quasar/Tauri app (Vue 3 + Pinia + Vue Router).
- **`packages/taskyon`** (`@taskyon/taskyon`) — core task engine. Exports raw TS via `exports` map (no build step). Entry points: `index.ts`, `browser.ts`, `tools/index.ts`, `db.ts`, `api/index.ts`.
- **`packages/shared`** (`@taskyon/shared`) — shared Vue components, Modelica tooling, UI utilities.
- **`packages/tycli`** (`@taskyon/tycli`) — Node CLI surface for chat and Node diagnostics. Built with tsup for the chat bundle; diagnostics scripts run directly via `--experimental-strip-types`.
- **`packages/tyclient`** (`@taskyon/tyclient`) — published client library (npm). Built with tsup.
- **`packages/p2p-core`** — libp2p networking. Built with tsup.
- **`packages/relay`** — P2P relay server. Built with Vite.
- **`packages/secure-tunnel`** — secure tunnel. Built with Vite.
- **`packages/rumoca`** — **git submodule** (separate repo, Rust/Modelica compiler). See its own `AGENTS.md`. Excluded from root ESLint.
- **`packages/yatra`** — **separate git repo** (Python). Excluded from root ESLint.

## Style

- Prettier: no semicolons, single quotes, 100-char print width, 2-space indent.
- ESLint: Vue `flat/recommended` + TypeScript `recommendedTypeChecked`. `consistent-type-imports` enforced (`type` imports required).
- `tsconfig.json` extends `.quasar/tsconfig.json` (auto-generated by Quasar).
- TypeScript: strict via `vue-tsc`. The `yarn lint` command runs `vue-tsc --noEmit` then ESLint.
- Put color, theme, shadow, border, background, and other visual styling in `src/css/app.sass`; Vue component styles should generally contain layout, sizing, spacing, positioning, and responsive structure only.

## Gotchas

- Modelica library archives are not bundled by app builds. Do not put large library files such as the MSL archive in `public/`, GitHub Pages, or other repository-published static assets. Mirror them to external object storage such as S3 instead, and use `yarn modelica:libraries:publish` manually to update `packages/shared/modelica/modelica_libraries.json`.
- Builds need `--max-old-space-size=8192` (set in Nix shell; set manually if not using Nix: `export NODE_OPTIONS="--max-old-space-size=8192"`).
- `packages/rumoca` and `packages/yatra` are separate git repos. Changes there should follow their own workflows, not root-level commands.
- `packages/tycli` diagnostics scripts use `--experimental-strip-types` instead of a compile step. Don't add a separate build step for them.
- `COREPACK_HOME` must be outside the repo (ESM/CJS conflict). The Nix shell handles this; if bypassing Nix, set `COREPACK_HOME` to a path outside any `type: "module"` package boundary.
- The `packages/taskyon` package exports TS source files directly. Import it via the `exports` map paths, not by relative file paths.
- Keep browser UI mode and Node headless mode aligned. Changes in shared runtime paths must work in both environments; do not fix headless by introducing a Node-only shortcut into code that is also used by the browser UI.
- When working on Modelica runtime bugs: debug generated JS first, then backport fixes to templates. See `packages/shared/modelica/README.md` for the mandatory debug loop.
- When the persisted Taskyon profile schema changes, bump the profile version in both `src/modules/taskyon/types.ts` and `src/assets/taskyon_settings.json`. Prefer invalidating old persisted profiles through the version number instead of adding one-off cleanup code for removed fields.
