import {
  createCryptoSession,
  type CryptoSession,
  type CryptoSessionOptions,
} from '@taskyon/taskyon'

const DEVICE_KEY_RECORD = 'deviceKeyPair'
const DEVICE_KEY_STORE = 'keys'
const WRAPPED_KEY_PREFIX = 'sk_'

export type BrowserCryptoPersistence = {
  namespace?: string
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
      const request = database
        .transaction(DEVICE_KEY_STORE, 'readwrite')
        .objectStore(DEVICE_KEY_STORE)
        .put(value, key)
      request.onsuccess = () => resolve()
      request.onerror = () => reject(new Error(request.error?.message || 'Record write failed'))
    })
  } finally {
    database.close()
  }
}

const deleteRecord = async (namespace: string, key: string): Promise<void> => {
  const database = await openDatabase(namespace)
  try {
    await new Promise<void>((resolve, reject) => {
      const request = database
        .transaction(DEVICE_KEY_STORE, 'readwrite')
        .objectStore(DEVICE_KEY_STORE)
        .delete(key)
      request.onsuccess = () => resolve()
      request.onerror = () => reject(new Error(request.error?.message || 'Record delete failed'))
    })
  } finally {
    database.close()
  }
}

const resolveNamespace = (options?: BrowserCryptoPersistence) =>
  options?.namespace?.trim() || 'ty_device_key'

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

export const initCryptoSessionFromBrowser = async (
  options?: CryptoSessionOptions,
  persist = false,
  browserPersistence?: BrowserCryptoPersistence,
): Promise<CryptoSession> => {
  const namespace = resolveNamespace(browserPersistence)
  const storedDeviceKey = await readRecord(namespace, DEVICE_KEY_RECORD)
  const deviceKeyPair = isUsableKeyPair(storedDeviceKey) ? storedDeviceKey : undefined
  let session = await createCryptoSession({ deviceKeyPair, ...options })

  if (!options?.wrappedSK) {
    const wrappedSessionKey = await readRecord(
      namespace,
      `${WRAPPED_KEY_PREFIX}${await session.getWrapperId()}`,
    )
    if (typeof wrappedSessionKey === 'string' && wrappedSessionKey) {
      session = await session.newSessionKey(wrappedSessionKey)
    }
  }

  if (persist) {
    await writeRecord(namespace, DEVICE_KEY_RECORD, session.getDeviceKey())
    await persistBrowserCryptoSession(session, browserPersistence)
  }
  return session
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
