# `@taskyon/spaceships`

Procedural spaceship scene and identicon generation used by Taskyon visual experiments.

The root export provides the generation/rendering API. Subpaths expose Vue lab components, schemas,
the default module library, and identicon caching.

The package is private and experimental. Generation is deterministic only when callers provide the
same algorithm configuration, library, version, and random seed.

Open `/spaceships` in the Taskyon development application to use the lab page.
