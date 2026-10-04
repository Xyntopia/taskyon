import {
  createCryptoSession,
  type CryptoSession,
  type BrowserCryptoSession,
  type CryptoSessionOptions,
} from '@taskyon/taskyon/runtime-core'

import { createNativeCryptoSession, type NativeDeviceCommands } from './nativeCryptoSession'
export type { NativeDeviceCommands } from './nativeCryptoSession'
export { parseNativeDeviceOpen, parseNativeSessionEnvelope } from './nativeCryptoSession'

const DEVICE_KEY_RECORD = 'deviceKeyPair'
const DEVICE_KEY_STORE = 'keys'
const WRAPPED_KEY_PREFIX = 'sk_'

export type BrowserCryptoPersistence = {
  namespace?: string
  nativeDevice?: NativeDeviceCommands
}

const openDatabase = (namespace: string): Promise<IDBDatabase> =>
  new Promise((resolve, reject) => {
    const request = globalThis.indexedDB.open(`CryptoSession_${namespace}`, 1)
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(DEVICE_KEY_STORE)) {
        request.result.createObjectStore(DEVICE_KEY_STORE)
      }
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(new Error(request.error?.message || 'Database open failed'))
  })

const isUsableKeyPair = (value: unknown): value is CryptoKeyPair => {
  if (!value || typeof value !== 'object') return false
  const pair = value as { privateKey?: unknown; publicKey?: unknown }
  return (
    pair.privateKey instanceof CryptoKey &&
    pair.privateKey.type === 'private' &&
    pair.publicKey instanceof CryptoKey &&
    pair.publicKey.type === 'public'
  )
}

const readRecord = async (namespace: string, key: string): Promise<unknown> => {
  const database = await openDatabase(namespace)
  try {
    return await new Promise<unknown>((resolve, reject) => {
      const request = database
        .transaction(DEVICE_KEY_STORE, 'readonly')
        .objectStore(DEVICE_KEY_STORE)
        .get(key)
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(new Error(request.error?.message || 'Record read failed'))
    })
  } finally {
    database.close()
  }
}

const writeRecord = async (namespace: string, key: string, value: unknown): Promise<void> => {
  const database = await openDatabase(namespace)
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(DEVICE_KEY_STORE, 'readwrite')
      const request = transaction.objectStore(DEVICE_KEY_STORE).put(value, key)
      request.onerror = () => reject(new Error(request.error?.message || 'Record write failed'))
      transaction.oncomplete = () => resolve()
      transaction.onabort = () =>
        reject(new Error(transaction.error?.message || 'Record write transaction aborted'))
    })
  } finally {
    database.close()
  }
}

const deleteRecord = async (namespace: string, key: string): Promise<void> => {
  const database = await openDatabase(namespace)
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(DEVICE_KEY_STORE, 'readwrite')
      const request = transaction.objectStore(DEVICE_KEY_STORE).delete(key)
      request.onerror = () => reject(new Error(request.error?.message || 'Record delete failed'))
      transaction.oncomplete = () => resolve()
      transaction.onabort = () =>
        reject(new Error(transaction.error?.message || 'Record deletion transaction aborted'))
    })
  } finally {
    database.close()
  }
}

const resolveNamespace = (options?: BrowserCryptoPersistence) =>
  `${options?.nativeDevice ? 'native-device-v1:' : ''}${options?.namespace?.trim() || 'ty_device_key'}`

export const persistBrowserCryptoSession = async (
  session: CryptoSession,
  options?: BrowserCryptoPersistence,
): Promise<void> => {
  const namespace = resolveNamespace(options)
  await writeRecord(
    namespace,
    `${WRAPPED_KEY_PREFIX}${await session.getWrapperId()}`,
    await session.exportSessionKey(),
  )
}

/** Clean cutover of the desktop-owned bootstrap, including retired agent scopes. */
const clearLegacyDesktopCryptoBootstrap = async () => {
  const markerNamespace = 'native-device-v1:ty_device_key'
  const markerKey = 'legacyDesktopBootstrapCleared'
  const marker = await readRecord(markerNamespace, markerKey)
  if (marker === true) return
  if (marker !== undefined) throw new Error('Stored native crypto cutover marker is unusable')
  if (!indexedDB.databases) throw new Error('Desktop crypto cutover requires database enumeration')
  const databases = await indexedDB.databases()
  for (const { name } of databases) {
    if (!name?.startsWith('CryptoSession_') || name.startsWith('CryptoSession_native-device-v1:'))
      continue
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.deleteDatabase(name)
      request.onsuccess = () => resolve()
      request.onerror = () => reject(new Error('Legacy desktop crypto cleanup failed'))
      request.onblocked = () => reject(new Error('Legacy desktop crypto cleanup blocked'))
    })
  }
  await writeRecord(markerNamespace, markerKey, true)
}

export function initCryptoSessionFromBrowser(
  options?: CryptoSessionOptions,
  persist?: boolean,
  browserPersistence?: BrowserCryptoPersistence & { nativeDevice?: undefined },
): Promise<BrowserCryptoSession>
export function initCryptoSessionFromBrowser(
  options: CryptoSessionOptions | undefined,
  persist: boolean,
  browserPersistence: BrowserCryptoPersistence,
): Promise<CryptoSession>
export async function initCryptoSessionFromBrowser(
  options?: CryptoSessionOptions,
  persist = false,
  browserPersistence?: BrowserCryptoPersistence,
): Promise<CryptoSession> {
  const namespace = resolveNamespace(browserPersistence)
  if (browserPersistence?.nativeDevice) await clearLegacyDesktopCryptoBootstrap()
  const storedDeviceKey = browserPersistence?.nativeDevice
    ? undefined
    : await readRecord(namespace, DEVICE_KEY_RECORD)
  if (storedDeviceKey !== undefined && !isUsableKeyPair(storedDeviceKey)) {
    throw new Error('Stored browser device key is unusable; refusing to replace its identity')
  }
  const nativeDevice = browserPersistence?.nativeDevice
  const browserSession = nativeDevice
    ? undefined
    : await createCryptoSession({ deviceKeyPair: storedDeviceKey, ...options })
  let session: CryptoSession
  if (nativeDevice) session = await createNativeCryptoSession(nativeDevice, options)
  else if (browserSession) session = browserSession
  else throw new Error('Crypto session owner is unavailable')

  try {
    if (!options?.wrappedSK) {
      const wrappedSessionKey = await readRecord(
        namespace,
        `${WRAPPED_KEY_PREFIX}${await session.getWrapperId()}`,
      )
      if (wrappedSessionKey !== undefined) {
        if (typeof wrappedSessionKey !== 'string' || !wrappedSessionKey) {
          throw new Error('Stored wrapped session key is unusable; refusing to replace it')
        }
        const initial = session
        session = await initial.newSessionKey(wrappedSessionKey)
        await initial.close?.()
      }
    }

    if (persist) {
      if (browserSession)
        await writeRecord(namespace, DEVICE_KEY_RECORD, browserSession.getDeviceKey())
      await persistBrowserCryptoSession(session, browserPersistence)
    }
    return session
  } catch (error) {
    await session.close?.()
    throw error
  }
}

export const deleteBrowserCryptoSession = async (
  session: CryptoSession,
  options?: BrowserCryptoPersistence,
): Promise<void> => {
  await deleteRecord(
    resolveNamespace(options),
    `${WRAPPED_KEY_PREFIX}${await session.getWrapperId()}`,
  )
}
