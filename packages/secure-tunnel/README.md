# @taskyon/secure-tunnel

A browser-side HTTPS-over-WebSocket tunnel client with in-browser TLS termination.

## Features

- End-to-end TLS encryption from browser to target server
- WebSocket-based tunneling through a proxy server
- Fetch-like API (`secureFetch`)
- Pure JavaScript TLS implementation (no Node.js dependencies)
- Supports HTTP/1.1 with chunked transfer encoding

## Installation

```bash
npm install @taskyon/secure-tunnel
```

## Usage

```typescript
import { secureFetch } from '@taskyon/secure-tunnel'

const response = await secureFetch('https://api.example.com/data', {
  method: 'GET',
  headers: {
    Authorization: 'Bearer token123',
  },
})

console.log(response.status)
console.log(response.body)
const data = await response.json()
```

## API

### `secureFetch(url, options)`

A fetch-like function that tunnels HTTPS requests through a WebSocket connection.

**Parameters:**

- `url` (string): The HTTPS URL to fetch
- `options` (object):
  - `method` (string): HTTP method (default: 'GET')
  - `headers` (object): Request headers
  - `body` (string | Uint8Array): Request body
  - `tunnelUrl` (string): WebSocket tunnel URL (default: auto-detected)

**Returns:** `SecureFetchResponse`

- `status` (number): HTTP status code
- `statusText` (string): HTTP status text
- `headers` (object): Response headers
- `body` (string): Response body as text
- `text()`: Returns body as string
- `json()`: Parses body as JSON
- `arrayBuffer()`: Returns body as ArrayBuffer

### `openTlsConnection(tunnelUrl, host, port)`

Low-level API to open a TLS connection through the tunnel.

## Tunnel Server Protocol

The tunnel server must implement this simple protocol:

1. Client sends: `CONNECT host:port`
2. Server responds: `CONNECTED` (or `ERROR: message`)
3. All subsequent binary messages are raw TCP data

## Building

```bash
npm run build
```

## License

MIT
