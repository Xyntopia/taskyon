# Files, Storage, and Secrets

Taskyon is local-first, but not every operation is local. A model call, browser tool, MCP server,
or application tool receives the data explicitly passed to it.

## Browser application

Task records and indexes are stored in browser-managed databases. Attached files use browser file
storage exposed through Taskyon's storage boundary. Clearing site data, changing profiles, or
using private browsing can remove locally stored information, so export important work.

## `tycli`

CLI configuration is stored under `~/.config/tycli` when writable. Durable task records use
`$XDG_DATA_HOME/tycli` or `~/.local/share/tycli`; `/tmp/tycli` is the fallback when a persistent
home directory is unavailable.

## Secrets

Provider keys and tool secrets are stored locally in encrypted form. A tool must request a secret
through its execution context. That boundary limits accidental access, but a tool that receives a
secret can still send it to its intended service or misuse it.

In the browser, Taskyon derives a key-encryption key from an X25519 device key and the active
binding context. The persisted session key is wrapped; encrypted database rows use their own
symmetric keys, which are wrapped by the session key. These mechanisms protect stored values but
do not make a compromised runtime or privileged host trustworthy.

Secrets are grouped by generated tool identity. This reduces accidental access by an unrelated
tool; it does not prove what an approved tool will do with a secret.

Review tool code, remote endpoints, and requested data before approval. Taskyon's security design
reduces ambient access; it does not replace endpoint trust, backups, host isolation, or a formal
security audit.

Backup phrases, passkeys, automatic cross-device recovery, and account-bound session restoration
are not part of the confirmed browser storage flow. Do not rely on them without a separately
implemented and documented host integration.
