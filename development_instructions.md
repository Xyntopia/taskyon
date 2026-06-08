# Development Instructions

- You are not allowed to bypass typing issues with unsafe casts or type invalidation patterns.
- Do not use `as unknown as ...`, `as any`, or JSON serialize/parse hacks to silence type errors.
- Find and fix the root cause of typing problems in types, interfaces, or function boundaries.
- If typing cannot be made correct immediately, stop and explain the blocker explicitly.
- When behavior, workflow, or runtime configuration changes, update the relevant docs (including Mermaid workflow charts) in the same change.
- Do not inject task-store accessors such as `getTask` or whole managers into tool-visible execution contexts. Keep tools isolated; resolve task references in the executor/materialization layer instead.
- We do not accept redundant code. Reuse existing helpers or create a single typed boundary helper instead of duplicating the same logic in multiple files.
- Do not add generic shared object-shape guards like `isRecord` to utility modules. Narrow dynamic values at the real boundary with a domain-specific parser/helper, then keep the rest of the code strongly typed.
- When moving tool settings from one tool to another, update `toolchainConfig`, default settings assets, and all settings UIs together so the owning tool remains the single source of truth.
- Do not manually thread `toolchainConfig` into tool implementations when the executor already injects toolchain defaults into tool arguments. Prefer using the tool's own arguments as the runtime source of truth.
- Validate and narrow dynamic values once at the boundary, convert them to strongly typed objects there, and pass typed values downstream instead of repeating ad-hoc `isRecord` checks.
- Always fix the root cause, not the symptom. Do not soften types, widen contracts, or add downstream guards just to silence errors; make the value strongly typed at the source and validate it there.
- Do not return fake no-op implementations just to preserve an API shape. If a capability is unavailable in a runtime, model it explicitly as optional and branch at the caller or during registration.
- Always run automatic lint error correction first (`yarn lint:fix` or package-local `lint:fix`) before final linting.
- Run formatting only on the specific files you edited, using the repository formatter configuration (for example `yarn format:file <path ...>`), not the whole repository.
- Always run `yarn lint` at the end and fix all reported errors.
