#!/usr/bin/env node
// Read-only by default. Opt-in writes only one disposable synthetic OS credential.
import { spawn } from 'node:child_process'
import { writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'

const run = (command, args, cwd) =>
  new Promise((resolveResult) => {
    const child = spawn(command, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] })
    let output = ''
    child.stdout.on('data', (chunk) => {
      output += chunk
    })
    child.stderr.on('data', (chunk) => {
      output += chunk
    })
    child.on('error', () => resolveResult({ ok: false, reason: 'CommandUnavailable' }))
    child.on('close', (code) => {
      const nativeError =
        /\b(Locked|Unavailable|MissingDeviceKey|CorruptDeviceKey|InvalidEnvelope)\b/.exec(
          output,
        )?.[1]
      resolveResult({
        ok: code === 0,
        ...(code === 0 ? {} : { reason: nativeError ?? 'CheckFailed' }),
      })
    })
  })

const main = async () => {
  const args = process.argv.slice(2)
  if (args.some((arg) => arg !== '--synthetic-roundtrip'))
    throw new Error('Usage: diagnose-native-custody.mjs [--synthetic-roundtrip]')
  const root = fileURLToPath(new URL('../', import.meta.url))
  const roundtrip = args.includes('--synthetic-roundtrip')
  const report = {
    timestamp: new Date().toISOString(),
    platform: process.platform,
    mode: roundtrip ? 'synthetic-roundtrip' : 'read-only-prerequisites',
    supportedDesktop: ['linux', 'darwin', 'win32'].includes(process.platform),
    linuxSessionBusConfigured:
      process.platform === 'linux' ? Boolean(process.env.DBUS_SESSION_BUS_ADDRESS) : null,
    cargo: await run('cargo', ['--version'], root),
    osVaultRoundtrip: { ok: false, reason: 'NotRequested' },
    limitations: [
      'No personal credential inventory or application profile is inspected.',
      'The OS check recreates the service; packaged Tauri IPC and a full app process restart require host smoke testing.',
      'Portable Rust/WebCrypto and browser-worker contract tests use a synthetic vault.',
    ],
  }
  if (roundtrip) {
    report.osVaultRoundtrip = await run(
      'cargo',
      [
        'test',
        '--locked',
        '--manifest-path',
        'src-tauri/Cargo.toml',
        'native_crypto::tests::os_vault_roundtrip',
        '--',
        '--ignored',
        '--exact',
      ],
      root,
    )
  }
  const filename = `native-custody-diagnostics-${new Date().toISOString().replace(/[:.]/g, '-')}.json`
  await writeFile(resolve(root, filename), `${JSON.stringify(report, null, 2)}\n`, {
    mode: 0o600,
    flag: 'wx',
  })
  console.log(`Redacted report: ${filename}`)
  if (roundtrip && !report.osVaultRoundtrip.ok) process.exitCode = 1
}

await main()
