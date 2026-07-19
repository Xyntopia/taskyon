# `@taskyon/surrogate`

Private surrogate-model utilities for engineering workflows.

The current public entry point exports the dependency-free Gaussian Process implementation,
kernels, prediction options, fitted-state serialization, and linear-algebra helpers. Broader
surrogate IR and exporter designs are not yet implemented.

The API is experimental and may change before external publication.

Run its diagnostics through:

```bash
yarn tycli:diagnostics --filter gaussian --details
```
