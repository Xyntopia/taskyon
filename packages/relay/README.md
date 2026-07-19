# `@taskyon/relay`

Taskyon's Node libp2p relay process.

The service delegates relay construction and logging to `@taskyon/p2p-core/relay`; it does not own
a second networking implementation.

From the repository root:

```bash
yarn relay
```

The package is private and operationally experimental. Relay addresses and deployment settings are
owned by the P2P configuration and deployment environment.
