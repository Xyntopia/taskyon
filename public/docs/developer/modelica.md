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

## Persistence

The browser editor and Node diagnostics use Taskyon's StorageClient rather than opening OPFS or a
feature-specific cache directory directly. This keeps Modelica independent of whether storage is
local, worker-hosted, remote, or eventually peer-backed.

- Projects are records in `modelica/projects`; the selected project is the
  `taskyon.modelica.projectId` record in `modelica/settings`.
- Editor settings are records in `modelica/editor`.
- Library archives and parsed outputs are content-addressed blobs. Metadata and rebuildable class
  indexes are records in their own `modelica/*` namespaces.
- External compiler processes may receive a temporary filesystem copy when they require a path.
  That copy is scratch data, not another durable cache.

The persisted project format remains `taskyon.modelica_project.v1`, and the simulation ABI remains
`taskyon.sim_service.v1`. Backend paths and filenames are implementation details and are not part of
either contract.
