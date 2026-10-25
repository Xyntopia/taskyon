import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const source = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')

void test('one Rust toolchain declaration supports Nix/Fenix and rustup', () => {
  const toolchain = source('rust-toolchain.toml')
  assert.match(toolchain, /channel\s*=\s*"1\.95\.0"/)
  assert.match(toolchain, /wasm32-unknown-unknown/)
  const flake = source('flake.nix')
  assert.match(flake, /fenix\.packages\.\$\{system\}\.fromToolchainFile/)
  assert.match(flake, /file\s*=\s*\.\/rust-toolchain\.toml/)
  assert.match(flake, /wasmBindgenCli/)
})

void test('direnv wasm shell is an alias of the default Fenix shell', () => {
  const flake = source('flake.nix')
  assert.match(flake, /devShells\s*=\s*rec\s*\{/)
  assert.match(flake, /wasm\s*=\s*default\s*;/)
})

void test('Nix provides yarn directly without mutable local Corepack shims', () => {
  const flake = source('flake.nix')
  assert.match(flake, /writeShellScriptBin\s+"yarn"/)
  assert.match(flake, /exec\s+\$\{pkgs\.nodejs_22\}\/bin\/corepack\s+yarn/)
  assert.match(flake, /\byarnBin\b/)
  assert.match(flake, /export PATH="\$\{yarnBin\}\/bin:\$PATH"/)
})

void test('normal Rust and Yarn builds have no Nix runtime dependency', () => {
  const app = JSON.parse(source('package.json'))
  const tunnel = JSON.parse(source('packages/https_tunnel_wasm/package.json'))
  const docker = source('Dockerfile')
  for (const command of [app.scripts.dev, app.scripts['build:tls-wasm'], tunnel.scripts.build]) {
    assert.doesNotMatch(command, /\bnix(?:-shell)?\b/)
  }
  assert.match(docker, /rustup target add wasm32-unknown-unknown/)
  assert.match(docker, /cargo install wasm-bindgen-cli/)
})

void test('non-Nix container pins the same wasm-bindgen version as the Rust package', () => {
  const cargo = source('packages/https_tunnel_wasm/Cargo.toml')
  const docker = source('Dockerfile')
  const devGuide = source('public/docs/developer/development.md')
  const version = cargo.match(/^wasm-bindgen\s*=\s*"([\d.]+)"/m)?.[1]
  assert.ok(version, 'missing wasm-bindgen dependency version')
  assert.match(docker, new RegExp(`--version\\s+${version.replaceAll('.', '\\.')}\\b`))
  assert.match(devGuide, new RegExp(`--version\\s+${version.replaceAll('.', '\\.')}\\b`))
})
