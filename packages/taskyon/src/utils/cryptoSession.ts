/**
 * @file useCryptoSession.ts
 * @description Complete crypto session management with key lifecycle, persistence, and sharing
 */

import {
  keyPairFromMnemonic,
  generateAssymetricKeyDeriver,
  generateWrappedSessionKey,
  unwrapSessionKey,
  reWrapSessionKey,
  deriveKek,
} from './crypto'

// ===================================================================================
//  INDEXEDDB PERSISTENCE (FUNCTIONAL)
// ===================================================================================

function createKeyStorage(namespace: string) {
  const dbName = `CryptoSession_${namespace}`
  let db: IDBDatabase | null = null

  const init = async (): Promise<void> => {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(dbName, 1)

      request.onupgradeneeded = () => {
        const database = request.result
        if (!database.objectStoreNames.contains('keys')) {
          database.createObjectStore('keys')
        }
      }

      request.onsuccess = () => {
        db = request.result
        resolve()
      }

      request.onerror = () =>
        reject(new Error(request.error?.message || 'Database initialization failed'))
    })
  }

  const set = async <T>(key: string, value: T): Promise<void> => {
    if (!db) throw new Error('Database not initialized')

    return new Promise((resolve, reject) => {
      const tx = db!.transaction('keys', 'readwrite')
      const store = tx.objectStore('keys')
      const request = store.put(value, key)

      request.onsuccess = () => resolve()
      request.onerror = () =>
        reject(new Error(request.error?.message || 'Storage operation failed'))
    })
  }

  const get = async <T>(key: string): Promise<T | undefined> => {
    if (!db) throw new Error('Database not initialized')

    return new Promise((resolve, reject) => {
      const tx = db!.transaction('keys', 'readonly')
      const store = tx.objectStore('keys')
      const request = store.get(key)

      request.onsuccess = () => resolve(request.result)
      request.onerror = () =>
        reject(new Error(request.error?.message || 'Storage retrieval failed'))
    })
  }

  const deleteKey = async (key: string): Promise<void> => {
    if (!db) throw new Error('Database not initialized')

    return new Promise((resolve, reject) => {
      const tx = db!.transaction('keys', 'readwrite')
      const store = tx.objectStore('keys')
      const request = store.delete(key)

      request.onsuccess = () => resolve()
      request.onerror = () => reject(new Error(request.error?.message || 'Storage deletion failed'))
    })
  }

  const destroy = async (): Promise<void> => {
    if (db) {
      db.close() // Close connection so deletion isn't blocked
      db = null
    }

    return new Promise((resolve, reject) => {
      const request = indexedDB.deleteDatabase(dbName)
      request.onsuccess = () => resolve()
      request.onerror = () =>
        reject(new Error(request.error?.message || 'Database deletion failed'))
      request.onblocked = () =>
        reject(new Error('Database deletion blocked (another connection is open)'))
    })
  }

  return { init, set, get, delete: deleteKey, destroy }
}

// ===================================================================================
//  MAIN IMPLEMENTATION
// ===================================================================================

export async function createCryptoSession(accountId: string) {
  const storageNamespace = 'ty_ucs_' + accountId

  // Initialize storage
  const storage = createKeyStorage(storageNamespace)
  await storage.init()

  const destroy = async (): Promise<void> => {
    await storage.destroy()
  }

  // Key identifiers
  const DEVICE_KEYPAIR_KEY = 'deviceKeyPair'
  const SESSION_KEY_WRAPPED = 'sessionKeyWrapped'
  const USER_PUBLIC_KEY = 'userPublicKey'

  // Initialize device key pair
  const initDeviceKey = async () => {
    // Try to load existing device key pair from storage
    const stored = await storage.get<CryptoKeyPair>(DEVICE_KEYPAIR_KEY)
    if (stored && stored.privateKey && stored.publicKey) {
      return stored
    }

    // Generate new device key pair
    const dkp = await generateAssymetricKeyDeriver()
    await storage.set(DEVICE_KEYPAIR_KEY, dkp)
    return dkp
  }

  const getWrappedSessionKey = async () => await storage.get<string>(SESSION_KEY_WRAPPED)

  // Initialize session key
  const initSessionKey = async (
    deviceKeyPair: CryptoKeyPair,
    options?: {
      renew?: boolean
      oldDeviceKeyPair?: CryptoKeyPair
      externalWrappedSessionKey?: string // if we want to add an external key
      persist?: boolean
    },
  ) => {
    const kek = await deriveKek(deviceKeyPair.privateKey, deviceKeyPair.publicKey)

    let wrappedSessionKey = options?.renew
      ? options.externalWrappedSessionKey
      : await getWrappedSessionKey()

    if (options?.oldDeviceKeyPair) {
      if (!wrappedSessionKey) throw new Error('No existing session key that we can re-wrap')
      const kekOld = await deriveKek(
        options.oldDeviceKeyPair.privateKey,
        options.oldDeviceKeyPair.publicKey,
      )
      wrappedSessionKey = await reWrapSessionKey(wrappedSessionKey, kekOld, kek)
    }

    if (!wrappedSessionKey) {
      wrappedSessionKey = await generateWrappedSessionKey(kek)
    }

    if (options?.persist) {
      await storage.set(SESSION_KEY_WRAPPED, wrappedSessionKey)
    }

    const sk = await unwrapSessionKey(wrappedSessionKey, kek)
    return sk
  }

  // Initialize user key pair
  const regenerateUserKey = async (mnemonic: string) => {
    // Generate user key pair (always new, in memory only)
    userKeyPair = (await keyPairFromMnemonic(mnemonic)) as unknown as CryptoKeyPair
    // Store public key for reference
    const publicKeyBytes = await crypto.subtle.exportKey('raw', userKeyPair.publicKey)
    await storage.set(USER_PUBLIC_KEY, publicKeyBytes)
    return publicKeyBytes
  }

  // Initialize all components
  let deviceKeyPair = await initDeviceKey()
  const sessionKey = await initSessionKey(deviceKeyPair, { persist: true })
  let userKeyPair: CryptoKeyPair | undefined = undefined

  // Public interface
  const getSessionKey = (): CryptoKey => {
    if (!sessionKey) throw new Error('Session not initialized')
    return sessionKey
  }

  const exportSessionKey = async (shareKey: CryptoKeyPair) => {
    const kek = await deriveKek(deviceKeyPair.privateKey, deviceKeyPair.publicKey)
    const shareKek = await deriveKek(shareKey.privateKey, shareKey.publicKey)

    const wrappedSessionKey = await getWrappedSessionKey()
    if (!wrappedSessionKey) throw new Error('no wrappedSessionKey available to export!')
    return await reWrapSessionKey(wrappedSessionKey, kek, shareKek)
  }

  const getDevicePublicKey = (): CryptoKey => {
    if (!deviceKeyPair) throw new Error('Device key pair not initialized')
    return deviceKeyPair.publicKey
  }

  const getUserPublicKey = () => {
    if (!userKeyPair) throw new Error('User key pair not initialized')
    return userKeyPair
  }

  const regenerateSessionKey = () => initSessionKey(deviceKeyPair, { renew: true, persist: true })

  const addWrappedSessionKey = async (exchangeKey: CryptoKeyPair, newKey: string) =>
    await initSessionKey(deviceKeyPair, {
      renew: true,
      externalWrappedSessionKey: newKey,
      oldDeviceKeyPair: exchangeKey,
      persist: true,
    })

  const regenerateDeviceKey = async (): Promise<void> => {
    const oldDeviceKeyPair = deviceKeyPair
    deviceKeyPair = await generateAssymetricKeyDeriver()
    await storage.set(DEVICE_KEYPAIR_KEY, deviceKeyPair)
    await initSessionKey(deviceKeyPair, { oldDeviceKeyPair, persist: true })
  }

  return {
    getSessionKey, // this is OK, because the ke is non-exportable...
    regenerateSessionKey,
    addWrappedSessionKey,
    exportSessionKey,

    getDevicePublicKey,
    getDeviceId: getDevicePublicKey,
    getUserPublicKey,
    regenerateDeviceKey,
    regenerateUserKey,
    destroy,
  }
}
