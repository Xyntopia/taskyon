import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { collectConsistencyErrors, isValidVersion, updateReleaseMetadata } from './release.mjs'

const createReleaseFixture = async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'taskyon-release-'))
  await mkdir(path.join(root, 'src-tauri'), { recursive: true })
  await writeFile(
    path.join(root, 'package.json'),
    JSON.stringify({ name: 'taskyon', version: '0.5.3' }, null, 2) + '\n',
  )
  await writeFile(
    path.join(root, 'src-tauri/tauri.conf.json'),
    JSON.stringify({ productName: 'taskyon', version: '0.1.0' }, null, 2) + '\n',
  )
  await writeFile(
    path.join(root, 'src-tauri/Cargo.toml'),
    '[package]\nname = "app"\nversion = "0.7.0"\n\n[dependencies]\nserde = "1"\n',
  )
  await writeFile(
    path.join(root, 'src-tauri/Cargo.lock'),
    '[[package]]\nname = "app"\nversion = "0.7.0"\ndependencies = []\n\n[[package]]\nname = "serde"\nversion = "1.0.0"\n',
  )
  return root
}

test('release version validation accepts SemVer and rejects malformed versions', () => {
  assert.equal(isValidVersion('0.6.0'), true)
  assert.equal(isValidVersion('0.6.0-rc.1'), true)
  assert.equal(isValidVersion('0.6.0+build.001'), true)
  assert.equal(isValidVersion('01.6.0'), false)
  assert.equal(isValidVersion('0.6'), false)
  assert.equal(isValidVersion('0.6.0-01'), false)
})

test('release metadata check identifies mismatched app and Tauri versions', async () => {
  const root = await createReleaseFixture()
  try {
    assert.deepEqual(collectConsistencyErrors(root).errors, [
      'src-tauri/tauri.conf.json has version 0.1.0, expected 0.5.3',
      'src-tauri/Cargo.toml has version 0.7.0, expected 0.5.3',
      'src-tauri/Cargo.lock has a stale app version',
    ])
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('release metadata update aligns app versions and leaves other Cargo packages unchanged', async () => {
  const root = await createReleaseFixture()
  try {
    updateReleaseMetadata(root, '0.6.0-rc.1')
    assert.deepEqual(collectConsistencyErrors(root), { expected: '0.6.0-rc.1', errors: [] })
    assert.equal(
      JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8')).version,
      '0.6.0-rc.1',
    )
    assert.equal(
      JSON.parse(await readFile(path.join(root, 'src-tauri/tauri.conf.json'), 'utf8')).version,
      '0.6.0-rc.1',
    )
    assert.match(
      await readFile(path.join(root, 'src-tauri/Cargo.toml'), 'utf8'),
      /version = "0\.6\.0-rc\.1"/,
    )
    assert.match(
      await readFile(path.join(root, 'src-tauri/Cargo.lock'), 'utf8'),
      /name = "app"\nversion = "0\.6\.0-rc\.1"/,
    )
    assert.match(
      await readFile(path.join(root, 'src-tauri/Cargo.lock'), 'utf8'),
      /name = "serde"\nversion = "1\.0\.0"/,
    )
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
