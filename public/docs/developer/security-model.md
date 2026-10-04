# Security and Cryptographic Storage

This page describes the current implementation, not a formal security proof. Taskyon has not
undergone a formal security audit.

## Browser crypto session

The normal browser path owns a non-extractable X25519 device key pair and stores the
`CryptoKeyPair` in IndexedDB. An unusable stored device identity fails explicitly rather than being
replaced. Some WebKit versions cannot restore this key pair; the raw-browser diagnostics continue to
report that compatibility failure.

[Tauri desktop device custody](native-device-custody.md) keeps the device private key in Rust and
the OS credential store. Only the public key, scoped handles and authenticated session envelopes
cross to JavaScript. There is no JWK, plaintext or browser persistence fallback. Desktop starts with
fresh native identities and clears its legacy crypto bootstrap databases, including retired agent namespaces; browser and
CLI installations keep their own custody.

Both paths bind session-key wrapping to the device identity and an optional host-supplied public
binding key. IndexedDB stores opaque wrapped session-key strings when persistence is explicitly
requested. Missing initialized native credentials, corrupted identities and unusable session records
fail instead of silently replacing keys. Unlocked session keys remain non-extractable WebCrypto
capabilities; existing sharing temporarily makes only a session key extractable before wrapping it.

The common session capability exposes session and binding derivation and public identities. Device
key regeneration remains specific to the browser owner; the native owner has no device reset or raw
private-key export operation. Existing desktop Bash approval is checked in JavaScript; arbitrary host
shell access prevents claiming full device-key isolation from compromised frontend code. A native
host-command boundary is pending a product decision. A session change rebuilds the dynamic Taskyon context because its
encrypted database and services are scoped by the session-key fingerprint.

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
- Interactive `tycli` mediates external fetches from sandboxed code tools and remembers the user's
  decision for the current session. This policy does not reduce the process permissions of
  privileged host tools.
- `tycli` and desktop shell/file tools operate with the process permissions of their host and need
  an external sandbox when that access is too broad.
- Remote MCP and model services must be treated as data recipients.

See [Files, Storage, and Secrets](../user/storage-and-security.md) for the user-facing trust model.
See [Tool sandbox security](../tool_sandbox_security.md) for sandbox lifetime, immutable tool
revisions, and mediated network and popup capabilities.
The target public/admin split is maintained in workspace-level architectural proposals.
