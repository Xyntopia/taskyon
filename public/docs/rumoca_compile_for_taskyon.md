# Compile Rumoca for Taskyon

This is the minimal local flow to build a Rumoca WASM package (`.tgz`) and use it in Taskyon.

## 0. What the bindgen build does

`packages/rumoca/crates/rumoca-bind-wasm/bindgen` contains helper scripts for `rumoca-bind-wasm`.

`npm run build` there will:
1. Build WASM from `rumoca-bind-wasm` (release, `web` target)
2. Patch `pkg/package.json` to match generated artifacts
3. Pack npm tarball from `pkg/` (the `.tgz` is emitted in `bindgen/`)

## 1. Build Rumoca WASM package

From the Taskyon repo root:

```bash
cd packages/rumoca/crates/rumoca-bind-wasm/bindgen
npm run build
```

Expected output example:

```bash
packages/rumoca/crates/rumoca-bind-wasm/bindgen/rumoca-0.8.0.a8.tgz
```

## 2. Point Taskyon to the local tarball

Edit root `package.json` and set `rumoca` in `dependencies` to that file:

```json
"rumoca": "file:packages/rumoca/crates/rumoca-bind-wasm/bindgen/rumoca-0.8.0.a8.tgz"
```

Then reinstall dependencies:

```bash
yarn install
```

## 3. Verify in Taskyon

Run Taskyon and open the Modelica flow:

```bash
yarn dev
```

If Taskyon loads `rumoca/rumoca_bg.wasm` and Modelica compile works, the local package is wired correctly.

## Useful build variants from bindgen README

1. Debug browser build:

```bash
cd packages/rumoca/crates/rumoca-bind-wasm/bindgen
npm run build:dev
```

2. Direct `wasm-pack` usage (from Rumoca root):

```bash
# browser ESM (recommended for Vite/browser use)
wasm-pack build crates/rumoca-bind-wasm --release --target web --out-dir pkg

# bundler mode
wasm-pack build crates/rumoca-bind-wasm --release --target bundler --out-dir pkg

# Node.js mode
wasm-pack build crates/rumoca-bind-wasm --release --target nodejs --out-dir pkg
```

## Notes

- For browser usage with Vite, `web` target is generally the best default.
- `vite-plugin-wasm` may be required in bundler setups.
- Bindgen patching normalizes output names like `rumoca.js` and `rumoca_bg.wasm`.
