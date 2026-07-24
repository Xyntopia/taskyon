# Security and Cryptographic Storage

This page describes the current implementation, not a formal security proof. Taskyon has not
undergone a formal security audit.

## Browser crypto session

The browser crypto session uses an X25519 device key pair. The normal browser path stores the
`CryptoKeyPair` in IndexedDB. Tauri has a JWK fallback because some WebView environments cannot
reliably clone stored `CryptoKey` objects.

A key-encryption key is derived from the device private key and either the device public key or a
host-supplied binding key. The session key is generated and wrapped by that key-encryption key.
When persistence is enabled, only the wrapped session-key string is stored in local storage.

The crypto session exposes explicit derivation operations for changing the session key, device key,
or binding key. A session change rebuilds the dynamic Taskyon context because its encrypted
database and services are scoped by the session-key fingerprint.

Backup phrases, passkeys, account-bound recovery secrets, and automatic cross-device session
exchange are not part of this confirmed browser flow and must not be documented as implemented.

## Encrypted records and secrets

Encrypted CRUD rows use a fresh symmetric row key. The payload is encrypted with AES-GCM using
record-specific derivation input, and the row key is wrapped by the session key. An optional public
recovery key can wrap the same row key through an ephemeral X25519 exchange.

The default secret store places encrypted rows in the active session database. Secrets are grouped
by a generated tool identity; the tool context calls:

```ts
await context.getSecret(name, askNew, saveNew)
await context.setSecret(name, value)
```

This namespace reduces accidental cross-tool access. It is not a defense against a privileged host,
modified Taskyon runtime, or a tool that deliberately sends a secret after receiving it.

## Capability boundaries

- Public task/protocol clients must not receive secret-store, session-switching, provider-key, or
  destructive administration methods.
- Client tools receive only the context registered by their host.
- Sandboxed code should receive narrow storage, network, and UI capabilities rather than a generic
  filesystem or parent-window API.
- `tycli` and desktop shell/file tools operate with the process permissions of their host and need
  an external sandbox when that access is too broad.
- Remote MCP and model services must be treated as data recipients.

See [Files, Storage, and Secrets](../user/storage-and-security.md) for the user-facing trust model.
The target public/admin split is documented in the workspace-level
`proposals/sandboxed-core-protocol.md` design document.
