# `@taskyon/common`

Shared, runtime-neutral modules used across Taskyon packages.

The package owns focused infrastructure such as typed FRP ports, diagnostics, graph helpers,
Markdown processing, sandbox runtimes, serialization, caching, and manifest-based documentation
resource loading.
Imports use the explicit `@taskyon/common/modules/<module>` export path; there is no broad root
barrel.

Browser-visible modules must not import Node-only dependencies. Runtime-specific sandbox
implementations are split into dedicated modules.

Verification is normally performed through the consuming package typecheck and the shared browser
or `tycli` diagnostics that discover exported `test*` functions.
