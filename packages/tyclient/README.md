# Taskyon Client Library

This is a lightweight library that lets you interact with a taskyon instance

- sending tasks & waiting for results
- initialize taskyon in iframe

... and more

## Development

We can use this package in a different app during development like this:

### Using `@taskyon/tyclient` Locally (Before Publishing)

You can test this package in another app without publishing to npm.  
Choose the method that fits your setup:

#### 1. Yarn Workspaces (best if in the same monorepo)

Add the dependency in the consuming app’s `package.json`:

```json
"dependencies": {
  "@taskyon/tyclient": "0.4.6"
}
```

Run `yarn install` — Yarn will automatically link the local package.

#### 2. Local File Install (recommended for external repos)

Install from a relative path:

```bash
yarn add file:../taskyon_front/packages/tyclient
```

This emulates a real npm install using your local build output.

#### 3. Yarn Link (quick symlink testing)

In the package:

```bash
cd packages/tyclient
yarn link
```

In the consuming app:

```bash
yarn link @taskyon/tyclient
```

This symlinks the package into `node_modules`.
⚠️ May cause duplicate dependency issues.
