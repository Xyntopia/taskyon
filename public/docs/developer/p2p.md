# P2P and Relay

`@taskyon/p2p-core` provides browser and Node libp2p entry points, relay support, discovery tokens,
topic routing, and test-network helpers. Start the repository relay with:

```bash
yarn relay
```

The browser exposes P2P chat and monitoring routes for development and diagnostics. Subnetwork
secrets are converted to discovery tokens so peers can match without publishing the original
secret.

This subsystem is experimental. Workspace-level protocol and storage proposals describe direction,
not guaranteed current behavior. Use package exports rather than importing private source paths.
