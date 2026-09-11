# @taskyon/https-tunnel-wasm

The browser TLS state machine used by `@taskyon/secure-tunnel`. Rustls validates the target
certificate and processes TLS 1.2/1.3 records; the TypeScript caller transports those records over
Taskyon's authenticated WebSocket proxy and implements HTTP/1.1.

The package uses the experimental pure-Rust `rustls-rustcrypto` provider because `ring` does not
produce a self-contained `wasm32-unknown-unknown` browser module. Keep that provider decision under
review as the Rustls WASM ecosystem matures.

Build the generated, ignored `pkg` directory with:

```bash
yarn workspace @taskyon/https-tunnel-wasm build
```

The main export initializes WASM in browsers. The explicit `./node` export loads the same artifact
from disk for integration tests; browser code must not import it.
