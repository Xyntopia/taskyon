import { constants } from 'node:fs'
import { access, mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { homedir } from 'node:os'
import { createCryptoSession, type Taskyon } from '@taskyon/taskyon'
import { API_KEY_STORE_NAME, type StoredConfig } from './types'

const PREFERRED_CONFIG_DIR = join(homedir(), '.config', 'tycli')
const FALLBACK_CONFIG_DIR = join('/tmp', 'tycli')
let cachedConfigFile: string | null = null

async function useFallbackConfigFile() {
  await mkdir(FALLBACK_CONFIG_DIR, { recursive: true })
  cachedConfigFile = join(FALLBACK_CONFIG_DIR, 'config.json')
  return cachedConfigFile
}

export async function resolveConfigFilePath() {
  if (cachedConfigFile) return cachedConfigFile
  try {
    await mkdir(PREFERRED_CONFIG_DIR, { recursive: true })
    await access(PREFERRED_CONFIG_DIR, constants.W_OK)
    cachedConfigFile = join(PREFERRED_CONFIG_DIR, 'config.json')
    return cachedConfigFile
  } catch {
    return await useFallbackConfigFile()
  }
}

export async function resolveConfigDirectoryPath() {
  const configFile = await resolveConfigFilePath()
  return dirname(configFile)
}

export async function loadStoredConfig(): Promise<StoredConfig> {
  try {
    const configFile = await resolveConfigFilePath()
    const raw = await readFile(configFile, 'utf8')
    const parsed = JSON.parse(raw) as StoredConfig
    return parsed ?? {}
  } catch {
    return {}
  }
}

async function saveStoredConfig(next: StoredConfig) {
  const configFile = await resolveConfigFilePath()
  const body = `${JSON.stringify(next, null, 2)}\n`
  try {
    await mkdir(dirname(configFile), { recursive: true })
    await writeFile(configFile, body, 'utf8')
  } catch (error) {
    if (configFile.includes(FALLBACK_CONFIG_DIR)) throw error
    const fallbackFile = await useFallbackConfigFile()
    await writeFile(fallbackFile, body, 'utf8')
  }
}

export async function persistConfigPatch(patch: Partial<StoredConfig>) {
  const current = await loadStoredConfig()
  await saveStoredConfig({ ...current, ...patch })
}

async function importDeviceKeyPair(
  jwk: NonNullable<StoredConfig['deviceKeyPairJwk']>,
): Promise<CryptoKeyPair> {
  const privateKey = await crypto.subtle.importKey(
    'jwk',
    jwk.privateJwk,
    { name: 'X25519' },
    true,
    ['deriveKey', 'deriveBits'],
  )
  const publicKey = await crypto.subtle.importKey(
    'jwk',
    jwk.publicJwk,
    { name: 'X25519' },
    true,
    [],
  )
  return { privateKey, publicKey }
}

async function exportDeviceKeyPair(keyPair: CryptoKeyPair) {
  if (!keyPair.privateKey.extractable || !keyPair.publicKey.extractable) {
    throw new Error('Device key pair is not extractable')
  }
  const privateJwk = await crypto.subtle.exportKey('jwk', keyPair.privateKey)
  const publicJwk = await crypto.subtle.exportKey('jwk', keyPair.publicKey)
  return { privateJwk, publicJwk }
}

async function createPersistableDeviceKeyPair(): Promise<CryptoKeyPair> {
  return (await crypto.subtle.generateKey({ name: 'X25519' }, true, [
    'deriveKey',
    'deriveBits',
  ])) as CryptoKeyPair
}

export async function initPersistentCryptoSession() {
  const stored = await loadStoredConfig()
  const persistedDevice = stored.deviceKeyPairJwk
    ? await importDeviceKeyPair(stored.deviceKeyPairJwk)
    : await createPersistableDeviceKeyPair()

  const cs = await createCryptoSession({
    deviceKeyPair: persistedDevice,
    wrappedSK: stored.wrappedSessionKey,
  })

  let exported: Awaited<ReturnType<typeof exportDeviceKeyPair>>
  try {
    exported = await exportDeviceKeyPair(cs.getDeviceKey())
  } catch {
    const freshPair = await createPersistableDeviceKeyPair()
    const refreshed = await createCryptoSession({
      deviceKeyPair: freshPair,
      wrappedSK: stored.wrappedSessionKey,
    })
    exported = await exportDeviceKeyPair(refreshed.getDeviceKey())
    const wrappedSessionKey = await refreshed.exportSessionKey()
    await saveStoredConfig({
      ...stored,
      deviceKeyPairJwk: exported,
      wrappedSessionKey,
    })
    return { cryptoSession: refreshed, stored }
  }
  const wrappedSessionKey = await cs.exportSessionKey()
  await saveStoredConfig({
    ...stored,
    deviceKeyPairJwk: exported,
    wrappedSessionKey,
  })

  return { cryptoSession: cs, stored }
}

export function resolveProviderSelection(stored: StoredConfig): string {
  const explicitApi = process.env.TASKYON_SELECTED_API
  if (explicitApi) return explicitApi
  if (stored.selectedApi) return stored.selectedApi
  if (process.env.OPENAI_API_KEY) return 'openai'
  if (process.env.OPENROUTER_API_KEY) return 'openrouter.ai'
  if (process.env.TASKYON_API_KEY) return 'taskyon'
  return 'local'
}

export function resolveKeyForProvider(provider: string): string | undefined {
  if (provider === 'openai') return process.env.TASKYON_OPENAI_API_KEY ?? process.env.OPENAI_API_KEY
  if (provider === 'openrouter.ai') {
    return process.env.TASKYON_OPENROUTER_API_KEY ?? process.env.OPENROUTER_API_KEY
  }
  if (provider === 'taskyon') return process.env.TASKYON_API_KEY
  if (provider === 'local') return process.env.TASKYON_LOCAL_API_KEY ?? 'local'
  return undefined
}

export async function setSelectedApi(ty: Taskyon, nextApi: string) {
  await persistConfigPatch({ selectedApi: nextApi })
  const key =
    (await ty.getSecret(API_KEY_STORE_NAME, nextApi, false, false)) ??
    resolveKeyForProvider(nextApi)
  await ty.updateChatCompletionApiKey(nextApi, key ?? undefined)
}
