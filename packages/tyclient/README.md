# `@taskyon/tyclient`

Browser client for embedding Taskyon and using its typed port protocol.

The package exports iframe initialization, client-tool registration, task execution, tool calls,
file upload, Markdown task import, and the supported `@taskyon/taskyon/api` contracts.

```ts
import { initializeTaskyon } from '@taskyon/tyclient'

const client = await initializeTaskyon({
  iframeId: 'taskyon',
  tools: [],
  configuration: {},
})

await client.runTasks(taskChains, 'return', { timeoutMs: 60_000 })
```

Build the package from the repository root:

```bash
yarn build:tyclient
```

Use a workspace dependency inside this monorepo. For external development, build and pack the
package rather than relying on `yarn link`, which can create duplicate runtime dependencies.
