# `@taskyon/sdk`

This package is the supported boundary for applications that embed Taskyon. Integrations should
import only from `@taskyon/sdk`, never from Taskyon's internal workspace packages or source paths.

The SDK is private while its API is incubating. `yarn pack:integrations <output-directory>` creates
local package archives for integration development. When this boundary is stable, the same package
can be published under an exact npm prerelease version without changing integration imports.
