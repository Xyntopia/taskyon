# Taskyon VS Code Extension (Dev)

## Build / Watch

```bash
# from repo root
yarn --cwd packages/taskyon-vscode install
yarn --cwd packages/taskyon-vscode build

# or keep a watch build running
yarn --cwd packages/taskyon-vscode watch
```

## Run Extension Host from Repo Root

```bash
# launch the Extension Host using this extension
code --extensionDevelopmentPath="$(pwd)/packages/taskyon-vscode"

# open the repo root as the workspace in the Extension Host
code --extensionDevelopmentPath="$(pwd)/packages/taskyon-vscode" .
```
