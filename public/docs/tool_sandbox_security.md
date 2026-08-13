# Tool sandbox security

Taskyon stores each tool definition as an immutable, content-addressed revision. Draft compilation
pins every function-call task to one revision before hashing it. The call keeps using that
implementation even after another revision becomes active under the same name; persistence does
not accept a completed executable task that omitted its tool revision.

The tool manager owns manifests, active name bindings, native runtime functions, installation, and
name-or-revision lookup. The resolved immutable identity also scopes secrets and capability
decisions. Serializable definitions and identities can cross the Taskyon protocol; native function
implementations remain inside the core runtime.

These registry definitions are distinct from `tooldefinition` tasks. A task-tree definition is
lexically scoped to its following lineage, is never installed in the registry, and may contain
only sandboxed code or a declarative binding to a pinned registry revision. Chat completion can
compile its reduced provider-facing signature, while the definition node itself stays out of model
messages and ordinary copied chat.

Tools have three execution classes:

- `trusted-native` tools are application code and run with host authority.
- `sandboxed-code` tools run JavaScript inside an isolated sandbox.
- `external-service` tools refer to an implementation owned by another host or service.

## Browser sandbox lifetime

The browser runs sandboxed code in a Blob worker hosted by an opaque `srcdoc` iframe. The iframe is
the browser security boundary; the worker keeps tool execution off the iframe's event loop and can
be terminated independently.

A sandbox is retained per immutable tool revision by default. Consecutive calls to that revision
may therefore reuse loaded libraries and in-memory variables. Calls are serialized per retained
sandbox so one execution's capabilities cannot be confused with another's. The sandbox is destroyed
when:

- the tool revision changes;
- an execution times out or fails at the runtime boundary;
- the caller aborts or explicitly terminates it; or
- the caller requests disposable mode.

Disposable mode creates a fresh sandbox for a call and destroys it afterward. Use it when retaining
in-memory state is undesirable. Retained state is a performance feature, not durable storage; tools
must persist important state through an explicit storage capability.

Pyodide is available only in the browser Python tool. Its verified, content-addressed assets and
initialized runtime can be cached inside the retained sandbox.

## CLI runtimes

The CLI uses Node for sandboxed JavaScript by default and can explicitly select Deno when it is
installed. JavaScript receives only the mediated capabilities supplied by Taskyon; selecting Deno
does not grant Deno filesystem, environment, network, or subprocess permissions.

The CLI does not load Pyodide. It offers the native Python tool only when a Python interpreter is
detected, and asks for session approval before the first execution. Native Python runs with the
operating-system permissions of the CLI process. Stronger process isolation, such as a bubblewrap
boundary on Linux, remains future hardening.

## Mediated capabilities

Sandboxed code does not receive a generic parent RPC channel. Taskyon supplies narrow, typed
capabilities. Both global `fetch` and `context.fetch` use the same mediated network implementation:

- `createSubtasksResult(...)` sends child drafts to trusted core and returns compiled, hashed tasks.
- `resolveInvocation(...)` returns only opaque tool and per-tool settings revisions for one named
  target; it does not expose registry contents or settings values.

1. Taskyon resolves the exact immutable tool identity.
2. It accepts HTTPS only, rejects URL credentials, and blocks obvious local, private-network, and
   metadata-service targets.
3. It classifies safe methods as read access and other methods as write access.
4. The host authorizes that tool revision, origin, and access class.
5. An allowed request runs without browser credentials or automatic redirects, with timeout and
   response-size limits. Denial, cancellation, or a limit violation becomes a tool error.

Browser popup access is a separate typed capability. Workers cannot open windows themselves. A
trusted host tool must request permission for either `custom-html` or an exact HTTPS origin before
opening a host-owned window.

Trusted-native tools still have host authority and can bypass these sandbox replacements. They must
be reviewed as application code. Browser URL checks also cannot fully prevent DNS rebinding; a
deployment that needs a strict SSRF boundary should proxy mediated requests through a server that
resolves and validates every destination.

Run the focused security diagnostics with:

```bash
yarn tycli:diagnostics \
  --filter tool_security_contracts
```
