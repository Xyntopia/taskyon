import { constants } from 'node:fs'
import { access, mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { createCryptoSession, type CryptoSession } from '@taskyon/taskyon'
import { type CrudWrapper, withSecretStore } from '../../../taskyon/src/utils/crudWrapper'
import { EncryptedDataRow } from '../../../taskyon/src/utils/encrypt'
import type { CliStoragePaths } from './storagePaths'
import { resolveTaskyonCliStoragePaths } from './storagePaths'
import { isReasoningEffort, type ReasoningEffort, type StoredConfig } from './types'

const CONFIG_LOCK_STALE_MS = 30_000
const CONFIG_LOCK_TIMEOUT_MS = 10_000
const CONFIG_LOCK_RETRY_MS = 50

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

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

export function createCliConfigStore(paths: CliStoragePaths) {
  let cachedConfigFile: string | null = null
  let cachedDataDir: string | null = null
  let configWriteQueue = Promise.resolve()

  const useFallbackConfigFile = async () => {
    await mkdir(paths.fallbackConfigDir, { recursive: true })
    cachedConfigFile = join(paths.fallbackConfigDir, 'config.json')
    return cachedConfigFile
  }

  const resolveConfigFilePath = async () => {
    if (cachedConfigFile) return cachedConfigFile
    try {
      await mkdir(paths.configDir, { recursive: true })
      await access(paths.configDir, constants.W_OK)
      cachedConfigFile = join(paths.configDir, 'config.json')
      return cachedConfigFile
    } catch {
      return await useFallbackConfigFile()
    }
  }

  const resolveReadableConfigFilePath = async () => {
    if (cachedConfigFile) return cachedConfigFile
    const preferredConfigFile = join(paths.configDir, 'config.json')
    try {
      await access(preferredConfigFile, constants.R_OK)
      cachedConfigFile = preferredConfigFile
      return cachedConfigFile
    } catch {
      return await resolveConfigFilePath()
    }
  }

  const resolveConfigDirectoryPath = async () => dirname(await resolveConfigFilePath())

  const resolveDataDirectoryPath = async () => {
    if (cachedDataDir) return cachedDataDir
    try {
      await mkdir(paths.dataDir, { recursive: true })
      await access(paths.dataDir, constants.W_OK)
      cachedDataDir = paths.dataDir
      return cachedDataDir
    } catch {
      await mkdir(paths.fallbackDataDir, { recursive: true })
      cachedDataDir = paths.fallbackDataDir
      return cachedDataDir
    }
  }

  const loadStoredConfig = async (): Promise<StoredConfig> => {
    try {
      const raw = await readFile(await resolveReadableConfigFilePath(), 'utf8')
      const parsed = JSON.parse(raw) as StoredConfig
      return parsed ?? {}
    } catch {
      return {}
    }
  }

  const saveStoredConfig = async (next: StoredConfig) => {
    const configFile = await resolveConfigFilePath()
    const body = `${JSON.stringify(next, null, 2)}\n`
    const writeAtomically = async (filePath: string) => {
      const temporaryFile = `${filePath}.${process.pid}.${Date.now()}.tmp`
      await writeFile(temporaryFile, body, 'utf8')
      await rename(temporaryFile, filePath)
    }

    try {
      await mkdir(dirname(configFile), { recursive: true })
      await writeAtomically(configFile)
    } catch (error) {
      if (configFile.startsWith(paths.fallbackConfigDir)) throw error
      await writeAtomically(await useFallbackConfigFile())
    }
  }

  const removeStaleConfigLock = async (lockDir: string) => {
    try {
      const info = await stat(lockDir)
      if (Date.now() - info.mtimeMs > CONFIG_LOCK_STALE_MS) {
        await rm(lockDir, { recursive: true, force: true })
      }
    } catch {
      // Missing or unreadable lock state is handled by the next mkdir attempt.
    }
  }

  const acquireConfigFileLock = async (lockDir: string) => {
    const startedAt = Date.now()
    for (;;) {
      try {
        await mkdir(lockDir)
        return
      } catch (error) {
        const code = error && typeof error === 'object' ? Reflect.get(error, 'code') : undefined
        if (code !== 'EEXIST') throw error
        await removeStaleConfigLock(lockDir)
        if (Date.now() - startedAt > CONFIG_LOCK_TIMEOUT_MS) {
          throw new Error(`Timed out waiting for CLI config lock: ${lockDir}`)
        }
        await sleep(CONFIG_LOCK_RETRY_MS)
      }
    }
  }

  const withConfigFileLock = async <T>(run: () => Promise<T>): Promise<T> => {
    const configFile = await resolveConfigFilePath()
    const lockDir = join(dirname(configFile), 'config.lock')
    await acquireConfigFileLock(lockDir)
    try {
      return await run()
    } finally {
      await rm(lockDir, { recursive: true, force: true })
    }
  }

  const updateStoredConfig = async (
    update: (current: StoredConfig) => StoredConfig | Promise<StoredConfig>,
  ) => {
    await withConfigFileLock(async () => {
      const current = await loadStoredConfig()
      await saveStoredConfig(await update(current))
    })
  }

  const persistConfigPatch = async (patch: Partial<StoredConfig>) => {
    const write = configWriteQueue
      .catch(() => {})
      .then(async () => updateStoredConfig((current) => ({ ...current, ...patch })))
    configWriteQueue = write.catch(() => {})
    await write
  }

  const flushConfigWrites = async () => await configWriteQueue

  const persistProviderModel = async (provider: string, model: string) => {
    await updateStoredConfig((current) => ({
      ...current,
      providerModels: { ...(current.providerModels ?? {}), [provider]: model },
      ...(current.selectedApi === provider ? { taskyonModel: model } : {}),
    }))
  }

  const persistReasoningEffort = async (reasoningEffort: ReasoningEffort) => {
    await persistConfigPatch({ reasoningEffort })
  }

  const initPersistentCryptoSession = async () =>
    await withConfigFileLock(async () => {
      const stored = await loadStoredConfig()
      const persistedDevice = stored.deviceKeyPairJwk
        ? await importDeviceKeyPair(stored.deviceKeyPairJwk)
        : await createPersistableDeviceKeyPair()
      const cryptoSession = await createCryptoSession({
        deviceKeyPair: persistedDevice,
        wrappedSK: stored.wrappedSessionKey,
      })

      try {
        const deviceKeyPairJwk = await exportDeviceKeyPair(cryptoSession.getDeviceKey())
        await saveStoredConfig({
          ...stored,
          deviceKeyPairJwk,
          wrappedSessionKey: await cryptoSession.exportSessionKey(),
        })
        return { cryptoSession, stored }
      } catch {
        const refreshed = await createCryptoSession({
          deviceKeyPair: await createPersistableDeviceKeyPair(),
          wrappedSK: stored.wrappedSessionKey,
        })
        await saveStoredConfig({
          ...stored,
          deviceKeyPairJwk: await exportDeviceKeyPair(refreshed.getDeviceKey()),
          wrappedSessionKey: await refreshed.exportSessionKey(),
        })
        return { cryptoSession: refreshed, stored }
      }
    })

  const createConfigSecretCrud = (): CrudWrapper<EncryptedDataRow> => {
    const readSecrets = async () => (await loadStoredConfig()).cliSecrets ?? {}
    const readRows = async () =>
      Object.entries(await readSecrets()).flatMap(([id, data]) => {
        const parsed = EncryptedDataRow.safeParse(data)
        return parsed.success ? [{ id, data: parsed.data }] : []
      })

    return {
      async set(id, data) {
        await updateStoredConfig((current) => ({
          ...current,
          cliSecrets: { ...(current.cliSecrets ?? {}), [String(id)]: data },
        }))
      },
      async get(id) {
        const row = (await readSecrets())[String(id)]
        const parsed = row ? EncryptedDataRow.safeParse(row) : null
        return parsed?.success ? parsed.data : null
      },
      async delete(id) {
        await updateStoredConfig((current) => {
          const cliSecrets = { ...(current.cliSecrets ?? {}) }
          delete cliSecrets[String(id)]
          return { ...current, cliSecrets }
        })
      },
      async listIds() {
        return (await readRows()).map((row) => row.id)
      },
      async list() {
        return await readRows()
      },
      async listAll() {
        return await readRows()
      },
      async clear() {
        await updateStoredConfig((current) => ({ ...current, cliSecrets: {} }))
      },
      async upsert(id, data) {
        await updateStoredConfig((current) => ({
          ...current,
          cliSecrets: { ...(current.cliSecrets ?? {}), [String(id)]: data },
        }))
        return data
      },
    }
  }

  const createCliSecretStore = (cryptoSession: CryptoSession) =>
    withSecretStore(
      createConfigSecretCrud(),
      () => cryptoSession.getUserPublicKey().publicKey,
      () => cryptoSession.getSessionKey(),
    )

  return {
    paths,
    createCliSecretStore,
    initPersistentCryptoSession,
    loadStoredConfig,
    flushConfigWrites,
    persistConfigPatch,
    persistProviderModel,
    persistReasoningEffort,
    resolveConfigDirectoryPath,
    resolveDataDirectoryPath,
  }
}

export type CliConfigStore = ReturnType<typeof createCliConfigStore>

export function resolveStoredModel(stored: StoredConfig, provider: string): string | undefined {
  const providerModel = stored.providerModels?.[provider]?.trim()
  if (providerModel) return providerModel
  if (stored.selectedApi === provider) return stored.taskyonModel?.trim() || undefined
  return undefined
}

export function resolveStoredReasoningEffort(stored: StoredConfig): ReasoningEffort | undefined {
  return isReasoningEffort(stored.reasoningEffort) ? stored.reasoningEffort : undefined
}

export function resolveProviderSelection(
  stored: StoredConfig,
  environmentPrefix = 'TASKYON',
  environment: Readonly<Record<string, string | undefined>> = process.env,
): string {
  const prefixed = (name: string) => environment[`${environmentPrefix}_${name}`]
  const explicitApi = prefixed('SELECTED_API')
  if (explicitApi) return explicitApi
  if (stored.selectedApi) return stored.selectedApi
  if (prefixed('OPENAI_API_KEY') || environment.OPENAI_API_KEY) return 'openai'
  if (
    prefixed('CHATGPT_CODEX_API_KEY') ||
    environment.TASKYON_CHATGPT_CODEX_API_KEY ||
    environment.CHATGPT_CODEX_API_KEY
  ) {
    return 'chatgpt-codex'
  }
  if (prefixed('OPENROUTER_API_KEY') || environment.OPENROUTER_API_KEY) return 'openrouter.ai'
  if (prefixed('API_KEY') || environment.TASKYON_API_KEY) return 'taskyon'
  return 'local'
}

export function resolveKeyForProvider(
  provider: string,
  environmentPrefix = 'TASKYON',
  environment: Readonly<Record<string, string | undefined>> = process.env,
): string | undefined {
  const prefixedKey = (name: string) => environment[`${environmentPrefix}_${name}`]
  if (provider === 'openai') return prefixedKey('OPENAI_API_KEY') ?? environment.OPENAI_API_KEY
  if (provider === 'chatgpt-codex') {
    return prefixedKey('CHATGPT_CODEX_API_KEY') ?? environment.CHATGPT_CODEX_API_KEY
  }
  if (provider === 'openrouter.ai') {
    return prefixedKey('OPENROUTER_API_KEY') ?? environment.OPENROUTER_API_KEY
  }
  if (provider === 'taskyon') return prefixedKey('API_KEY') ?? environment.TASKYON_API_KEY
  if (provider === 'local') return prefixedKey('LOCAL_API_KEY') ?? 'local'
  return undefined
}

const taskyonConfigStore = createCliConfigStore(resolveTaskyonCliStoragePaths())

export const createCliSecretStore = taskyonConfigStore.createCliSecretStore
export const flushConfigWrites = taskyonConfigStore.flushConfigWrites
export const initPersistentCryptoSession = taskyonConfigStore.initPersistentCryptoSession
export const loadStoredConfig = taskyonConfigStore.loadStoredConfig
export const persistConfigPatch = taskyonConfigStore.persistConfigPatch
export const persistProviderModel = taskyonConfigStore.persistProviderModel
export const persistReasoningEffort = taskyonConfigStore.persistReasoningEffort
export const resolveConfigDirectoryPath = taskyonConfigStore.resolveConfigDirectoryPath
export const resolveDataDirectoryPath = taskyonConfigStore.resolveDataDirectoryPath
