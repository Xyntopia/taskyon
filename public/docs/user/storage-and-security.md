# Files, Storage, and Secrets

Taskyon is local-first, but not every operation is local. A model call, browser tool, MCP server,
or application tool receives the data explicitly passed to it.

## Browser application

Task records, indexes, settings, and attached files are stored through one scoped StorageClient.
The browser host selects record and blob providers independently from OPFS, IndexedDB, or PGlite
where supported, remembers that selection, and exposes only logical storage operations to Taskyon.
Clearing site data, changing profiles, or using private browsing can remove locally stored
information, so export important work.

## `tycli`

CLI configuration is stored under `~/.config/tycli` when writable. Durable task records use
`$XDG_DATA_HOME/tycli` or `~/.local/share/tycli`; `/tmp/tycli` is the fallback when a persistent
home directory is unavailable. After the first submitted conversation message, the CLI also keeps
a readable Markdown transcript in its blob storage. Tasks remain authoritative; the transcript is
an optional CLI-owned projection used for inspection and recovery.

Set `TYCLI_DATA_DIR` for an isolated debugging or evaluation run. It relocates Taskyon records and
blobs—including generated tools, task state, artifacts, transcripts, and indexes—without replacing
the normal configuration, selected provider/model, OAuth login, or encrypted secret store. Do not
copy credentials into the run directory.

## Current storage protection

The current general StorageClient path is local-only and uses a trusted-local plaintext record
codec. Its namespace prefix separates Taskyon data from other host data, but that prefix is
organization rather than encryption or an operating-system security boundary. The client rejects
remotely eligible storage until an authenticated encrypted codec is configured.

Encrypted Space storage, cross-device replication, shared Spaces, opaque provider identifiers, and
P2P storage recovery are planned architecture rather than current user-facing storage features.
The separate secret-storage mechanisms described below already encrypt supported secrets; that
does not imply that ordinary StorageClient records and blobs are encrypted.

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

In interactive `tycli`, a sandboxed code tool that requests an external network origin pauses for
approval. An allow or deny decision is remembered for the current session. Privileged host tools
such as the shell still have the permissions of the process and require an external sandbox when
that access is too broad.

Backup phrases, passkeys, automatic cross-device recovery, and account-bound session restoration
are not part of the confirmed browser storage flow. Do not rely on them without a separately
implemented and documented host integration.
