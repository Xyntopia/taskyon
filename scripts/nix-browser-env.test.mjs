import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { chromium } from 'playwright'

const flake = readFileSync(new URL('../flake.nix', import.meta.url), 'utf8')

test('Nix shell scopes native library paths instead of injecting them into every process', () => {
  const shellHook = flake.split('shellHook =')[1]
  assert.ok(shellHook, 'missing Nix development shell hook')
  assert.match(shellHook, /unset LD_LIBRARY_PATH/)
  assert.doesNotMatch(shellHook, /export LD_LIBRARY_PATH\s*=/)
  assert.match(flake, /NIX_LD_LIBRARY_PATH/)
  assert.match(flake, /TASKYON_TAURI_LIBRARY_PATH/)
  const packageJson = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
  for (const [name, command] of Object.entries(packageJson.scripts)) {
    if (name.startsWith('tauri:')) {
      assert.match(
        command,
        /bash (?:\.\/)?scripts\/run-tauri\.sh/,
        `Tauri command ${name} must scope its libraries`,
      )
    }
  }
  const launcher = readFileSync(new URL('./run-tauri.sh', import.meta.url), 'utf8')
  assert.match(launcher, /export LD_LIBRARY_PATH="\$TASKYON_TAURI_LIBRARY_PATH"/)
})

test('Chromium launches from the Nix development shell', async (t) => {
  if (!process.env.IN_NIX_SHELL) return t.skip('run inside nix develop to exercise the browser')
  assert.equal(process.env.LD_LIBRARY_PATH, undefined)
  const browser = await chromium.launch()
  try {
    const page = await browser.newPage()
    await page.goto('data:text/html,<title>Playwright smoke</title>')
    assert.equal(await page.title(), 'Playwright smoke')
  } finally {
    await browser.close()
  }
})
