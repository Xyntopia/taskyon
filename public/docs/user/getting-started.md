# Getting Started

## Run locally

Taskyon requires Node.js 20 or newer and Yarn 4.

```bash
yarn install
yarn dev
```

Open `http://localhost:9000`. The Nix development shell provides the pinned toolchain when Nix is
available.

## Select an AI provider

Open **Settings**, choose **AI Service Provider**, and configure a provider and model. Provider
credentials are requested separately and stored in Taskyon's local secret store. A local
OpenAI-compatible endpoint can be used without sending prompts to a hosted model provider.

## Create a task

Enter a concrete request in the chat input. Taskyon stores the user message, entry-node decision,
tool calls, intermediate results, and final response as linked task nodes. Open **Task Manager** to
search prior work or inspect its task tree.

## Next steps

- Use [Browser Access](browser-research.md) for source-backed research.
- Add or import capabilities through [Tools and MCP](tools-and-mcp.md).
- Read [Files, storage, and secrets](storage-and-security.md) before handling sensitive
  material.
