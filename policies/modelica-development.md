# Modelica Development Policy

Apply this policy before changing Modelica compilation, generated code, templates, runtime,
simulation, library handling, or comparison diagnostics.

## Root-Cause Workflow

- Reproduce runtime failures in the generated program before changing templates or compiler
  phases.
- Fix and verify the generated behavior first, then backport the correction to the highest owning
  template or compiler source.
- Do not keep a generated-output patch as the final fix when an upstream owner can produce it
  correctly.
- Compare against an independent implementation or reference trace when numerical or semantic
  correctness is involved.

## Runtime Compatibility

- Keep compiler and simulation changes compatible with the browser and supported native/CLI
  runtimes.
- Keep browser-visible modules free of Node-only imports.
- Model unavailable capabilities at the runtime boundary instead of introducing fake behavior.
- Keep test models and expected payloads grounded in actual supported Modelica semantics.

## Libraries And Generated Artifacts

- Do not commit large Modelica library archives into public application assets or
  repository-published static documentation.
- Treat generated programs, traces, extracted libraries, and comparison output as reproducible
  artifacts unless a fixture is intentionally owned by a focused test.
- Follow the current package README for exact commands and source locations; those operational
  details may change without changing this policy.

## Verification

- Add or update the focused comparison or diagnostics case for changed behavior.
- Verify the generated program and the upstream source fix.
- Keep browser and CLI diagnostic semantics aligned.
