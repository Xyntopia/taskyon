# Modelica

Taskyon integrates Rumoca compilation, JavaScript and native simulation, library catalogs, browser
editing, and OMC comparison tooling.

```bash
yarn modelica:cli
yarn modelica:compare
yarn modelica:compare:native
yarn modelica:baseline:diff
```

Before changing Modelica compiler, template, runtime, or simulation code, read
`packages/modelica/README.md`. Runtime bugs must first be reproduced and fixed in generated
JavaScript, then backported to the owning template or compiler layer.

The browser compiler currently consumes the `rumoca-full-web` package alias. For local Rumoca
compiler development, follow the source-build and dependency-override workflow in
`packages/modelica/README.md`; it is the maintained source of truth. The previous documentation's
versioned tarball and manual archive-copy procedure no longer matches the workspace dependency
flow.

Modelica library archives are downloaded from the configured catalog and cache. They must not be
committed under `public/`.
