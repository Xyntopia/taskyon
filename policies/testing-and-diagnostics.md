# Testing And Diagnostics Policy

Apply this policy whenever behavior changes or tests, diagnostics, fixtures, or verification paths
are added.

## Diagnostics Are Part Of The Product

- Every meaningful feature should expose a small diagnostic or focused test through the normal
  diagnostics boundary.
- Write or update the targeted test before implementation when the change needs a behavioral or
  regression test.
- Use evidence from real code paths, logs, generated output, and runtime behavior; do not duplicate
  production helpers inside tests.
- Keep checks proportional to the blast radius and avoid broad unrelated test rewrites.

## Shared Runtime Coverage

- Shared Taskyon diagnostics must run in browser and Node/CLI unless an unavailable runtime
  capability is explicitly modeled and skipped at the diagnostics boundary.
- Add tests where existing diagnostics discovery can find them, or register them with the owning
  diagnostics runner.
- Do not create a separate build-only test path when the runtime already executes diagnostics
  directly.
- Ask for browser verification when a shared behavior cannot be fully exercised in the current
  environment.

## Test And Product Boundary

- Test user-visible behavior through the UI, DOM, CLI output, or documented runtime APIs where
  possible. Do not tailor production stores, components, or tools only to make a test easier.
- Keep feature-specific orchestration in tests or test-support code. Any production test hook must
  be generic and development-only.
- Playwright tests should wait for rendered DOM evidence instead of subscribing to internal task
  streams when a stable user-visible signal exists.
- Do not assert generated task IDs, selected-task URLs, or other implementation details unless they
  are themselves part of the product contract.
- Mock optional external services at the network boundary. Deterministic tests must not require
  optional local environment files.

## Model And External-Service Tests

- Diagnostics involving an LLM use the active runtime/profile settings or explicit harness
  overrides.
- Do not construct a hidden provider, model, credential, or API configuration inside a test.
- Treat existing provider, credential, fixture, and environment setup as evidence of intentional
  coverage. Do not remove, relocate, mock, skip, or reclassify that setup to make a test local or
  deterministic without confirming the coverage change with the user first.
- When provider-independent coverage is also useful, add a separate focused test. Do not replace or
  narrow an existing external-service test.
- Mark network, paid-service, large-token, and other external requirements explicitly.
- Separate failures in external availability from regressions in local behavior.

## Verification Discipline

- Run focused type checks, diagnostics, and tests for the changed ownership boundary.
- Format every edited file with the repository formatter and only target edited files.
- Do not automatically run broad lint or slow suites unless requested or justified by the change.
- Never weaken a test to accommodate broken behavior.
- Report which checks ran, what did not run, and any residual environmental limitation.
