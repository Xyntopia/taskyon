# @taskyon/secure-tunnel

A browser-side HTTPS-over-WebSocket tunnel client with in-browser TLS termination.

## Features

- End-to-end TLS encryption from browser to target server
- WebSocket-based tunneling through a proxy server
- Fetch-like API (`secureFetch`)
- Rustls compiled to WebAssembly (no Node.js runtime dependency in the browser)
- Supports HTTP/1.1 with chunked transfer encoding

## Installation

```bash
npm install @taskyon/secure-tunnel
```

## Usage

```typescript
import { secureFetch } from '@taskyon/secure-tunnel'
import { createTunnelTokenProvider } from '@taskyon/taskyon/taskyon-space-api'

// authToken is the user's credential; it is never sent to the tunnel or target.
const getTunnelToken = createTunnelTokenProvider(
  'https://share.taskyon.space',
  tokenServiceBaseUrl,
  authToken,
)

const response = await secureFetch('https://api.example.com/data', {
  tunnelUrl: 'wss://share.taskyon.space/ws-proxy',
  getTunnelToken,
  method: 'GET',
  headers: {
    Authorization: 'Bearer token123',
  },
})

console.log(response.status)
const data = await response.json()
```

## API

### `secureFetch(url, options)`

A fetch-like function that tunnels HTTP or HTTPS requests through one authenticated WSS endpoint.
Only effective ports 80 and 443 are accepted. HTTPS is terminated and certificate-validated in
the browser. Response bodies stream, and redirects obtain a fresh destination-scoped token.

**Parameters:**

- `url` (string): The HTTPS URL to fetch
- `options` (object):
  - `method` (string): HTTP method (default: 'GET')
  - `headers` (object): Request headers
  - `body` (string | Uint8Array): Request body
  - `tunnelUrl` (string): WebSocket tunnel URL
  - `getTunnelToken` (function): Mints a token for a `{ host, port }` destination

**Returns:** `SecureFetchResponse`

- `status` (number): HTTP status code
- `statusText` (string): HTTP status text
- `headers` (object): Response headers
- `text()`: Returns body as string
- `json()`: Parses body as JSON
- `arrayBuffer()`: Returns body as ArrayBuffer

Use `createCachedSecureFetch(fetchImpl, cache)` for HTTP-cache-header-aware local caching. Taskyon
exports `createStorageClientSecureFetchCache(storage)` for its existing scoped StorageClient.
Credential-bearing requests and `no-store` responses are not cached.

### `openTlsConnection(tunnelUrl, host, port, token)`

Low-level API to open a TLS connection through the tunnel.

## Tunnel Server Protocol

The library is designed to work with the wsproxy WebSocket-to-TCP proxy server.

**Connection URL format:**

```
wss://proxy-host/ws-proxy?host=target.example.com&port=443
```

The tunnel server:

1. Receives a WebSocket using the `taskyon-tunnel-v1` protocol and bearer subprotocol
2. Verifies the issuer signature, its own top-level `cnf.jwk` binding, and exact destination claim;
   synchronously records `jti` in its instance-local replay map before opening a target socket
3. Resolves and pins a public address, then forwards bounded binary data in both directions

The service creates an in-memory Ed25519 key alongside its replay map. Public discovery at
`/settlement-public-key` returns `{ cnf: { jwk: { kty, crv, x } } }` with `Cache-Control: no-store`.
The Taskyon token provider caches only this public key in memory. On the specific pre-work
`instance_key_mismatch` rejection, secureFetch refreshes and remints once; no other failure is
automatically replayed. HTTPS discovery must be trusted, and multiple replicas need routing
affinity between discovery and execution. Never share an instance key without shared replay state.

Billing uses `/return` with `{ settlementJwt }`: an EdDSA JWT of
`{ token, credits_spent_increase, reference_data }`, with type `taskyon-settlement+jwt`.
Supabase verifies the original token first and the bill against its `cnf.jwk`. Deploy the updated
Supabase function first: keyless legacy tokens retain unsigned settlement, but tokens containing
`cnf` always require proof. The updated Taskyon service rejects keyless tokens. No `/consume`
request, service registration, persistent service secret, or new database migration is needed.

The TLS engine is `packages/https_tunnel_wasm`: TypeScript owns the authenticated WebSocket and
HTTP/1.1 stream, while Rustls owns certificate validation, the TLS handshake, encryption, and
record processing. The production build generates the ignored WASM package from Rust source.

The standard network diagnostics include `testSecureFetchRustTlsThroughLocalRelay`. It starts a
test-only loopback WebSocket-to-TCP relay and fetches both HTTP and HTTPS from `example.com`; the
HTTPS connection is terminated by Rustls WASM. This test does not use Supabase or the commercial
Taskyon proxy. The in-app `testSecureFetch` diagnostic additionally exercises browser requests
through the hosted WSS relay when that commercial service is available.

The TLS client permits only TLS 1.2 and 1.3. The public smoke-target catalog contains 117 HTTP,
HTTPS, API, redirect, streaming, compression, and TLS-policy cases for deployments that provide a
compatible authenticated tunnel.

## Building

```bash
npm run build
```

## License

MIT
