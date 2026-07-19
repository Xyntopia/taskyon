# `@taskyon/p2p-core`

Private libp2p infrastructure shared by browser Taskyon, Node diagnostics, and the relay service.

Supported package entry points include:

- `@taskyon/p2p-core/browser`
- `@taskyon/p2p-core/node`
- `@taskyon/p2p-core/relay`
- `@taskyon/p2p-core/discovery`
- `@taskyon/p2p-core/constants`

The package provides transport setup, relay connections, topic routing, subnetwork discovery
tokens, and test-network helpers. The protocol remains experimental.

```bash
yarn workspace @taskyon/p2p-core build
yarn tycli:diagnostics --filter discovery --details
```
