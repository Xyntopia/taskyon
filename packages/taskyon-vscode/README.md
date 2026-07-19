# Taskyon VS Code Extension (Dev)

The extension adds a Taskyon activity-bar webview and commands to open Taskyon in the webview or an
external browser.

Settings:

- `taskyon.url`: Taskyon base URL.
- `taskyon.openIn`: `webview` or `external`.

## Build / Watch

```bash
# from repo root
yarn --cwd packages/taskyon-vscode install
yarn --cwd packages/taskyon-vscode build

# or keep a watch build running
yarn --cwd packages/taskyon-vscode watch
```

Package a VSIX with:

```bash
yarn --cwd packages/taskyon-vscode package
```

## Run Extension Host from Repo Root

```bash
# launch the Extension Host using this extension
code --extensionDevelopmentPath="$(pwd)/packages/taskyon-vscode"

# open the repo root as the workspace in the Extension Host
code --extensionDevelopmentPath="$(pwd)/packages/taskyon-vscode" .
```
