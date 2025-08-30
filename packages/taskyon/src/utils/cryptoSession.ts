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
//  CRYPTO UTILITIES
// ===================================================================================

const CryptoUtils = {
  generateDeviceKeyPair: generateAssymetricKeyDeriver,
  generateUserKeyPair: keyPairFromMnemonic,

  async deriveKek(privateKey: CryptoKey, publicKey: CryptoKey): Promise<CryptoKey> {
    return crypto.subtle.deriveKey(
      { name: 'X25519', public: publicKey },
      privateKey,
      { name: 'AES-KW', length: 256 },
      false,
      ['wrapKey', 'unwrapKey'],
    )
  },
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
    const dkp = await CryptoUtils.generateDeviceKeyPair()
    await storage.set(DEVICE_KEYPAIR_KEY, deviceKeyPair)
    return dkp
  }

  // Initialize session key
  const initSessionKey = async (
    renew = false,
    deviceKeyPair: CryptoKeyPair,
    oldDeviceKeyPair?: CryptoKeyPair,
  ) => {
    const kek = await CryptoUtils.deriveKek(deviceKeyPair.privateKey, deviceKeyPair.publicKey)

    let wrappedSessionKey = undefined
    wrappedSessionKey = renew ? undefined : await storage.get<ArrayBuffer>(SESSION_KEY_WRAPPED)
    if (oldDeviceKeyPair) {
      if (!wrappedSessionKey) throw new Error('No existing session key that we can re-wrap')
      const kekOld = await CryptoUtils.deriveKek(deviceKeyPair.privateKey, deviceKeyPair.publicKey)
      wrappedSessionKey = await reWrapSessionKey(wrappedSessionKey, kekOld, kek)
    }

    if (!wrappedSessionKey) {
      wrappedSessionKey = await generateWrappedSessionKey(kek)
      await storage.set(SESSION_KEY_WRAPPED, wrappedSessionKey)
    }
    const sk = await unwrapSessionKey(wrappedSessionKey, kek)
    return sk
  }

  // Initialize user key pair
  const regenerateUserKey = async (mnemonic: string) => {
    // Generate user key pair (always new, in memory only)
    const userKeyPair = (await CryptoUtils.generateUserKeyPair(
      mnemonic,
    )) as unknown as CryptoKeyPair
    // Store public key for reference
    const publicKeyBytes = await crypto.subtle.exportKey('raw', userKeyPair.publicKey)
    await storage.set(USER_PUBLIC_KEY, publicKeyBytes)
    return publicKeyBytes
  }

  // Initialize all components
  let deviceKeyPair = await initDeviceKey()
  const sessionKey = await initSessionKey(false, deviceKeyPair)
  const userKeyPair: ArrayBuffer | undefined = undefined

  // Public interface
  const getWrappedSessionKey = (): CryptoKey => {
    if (!sessionKey) throw new Error('Session not initialized')
    return sessionKey
  }

  const getDevicePublicKey = (): CryptoKey => {
    if (!deviceKeyPair) throw new Error('Device key pair not initialized')
    return deviceKeyPair.publicKey
  }

  const getUserPublicKey = () => {
    if (!userKeyPair) throw new Error('User key pair not initialized')
    return userKeyPair
  }

  const regenerateSessionKey = () => initSessionKey(true, deviceKeyPair)

  const regenerateDeviceKey = async (): Promise<void> => {
    const oldDeviceKeyPair = deviceKeyPair
    deviceKeyPair = await CryptoUtils.generateDeviceKeyPair()
    await storage.set(DEVICE_KEYPAIR_KEY, deviceKeyPair)
    await initSessionKey(false, oldDeviceKeyPair, deviceKeyPair)
  }

  return {
    getWrappedSessionKey,
    getDevicePublicKey,
    getDeviceId: getDevicePublicKey,
    getUserPublicKey,
    regenerateSessionKey,
    regenerateDeviceKey,
    regenerateUserKey,
    destroy,
  }
}
