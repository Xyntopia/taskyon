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

// Global registry to track database connections
const dbConnections = new Map<string, { db: IDBDatabase; refCount: number }>()

function createKeyStorage(namespace: string) {
  const dbName = `CryptoSession_${namespace}`

  const init = async (): Promise<void> => {
    // Check if we already have a connection
    const existing = dbConnections.get(dbName)
    if (existing) {
      existing.refCount++
      return
    }

    return new Promise((resolve, reject) => {
      const request = indexedDB.open(dbName, 1)

      request.onupgradeneeded = () => {
        const database = request.result
        if (!database.objectStoreNames.contains('keys')) {
          database.createObjectStore('keys')
        }
      }

      request.onsuccess = () => {
        const db = request.result
        dbConnections.set(dbName, { db, refCount: 1 })
        resolve()
      }

      request.onerror = () =>
        reject(new Error(request.error?.message || 'Database initialization failed'))
    })
  }

  const getDb = (): IDBDatabase => {
    const connection = dbConnections.get(dbName)
    if (!connection) throw new Error('Database not initialized')
    return connection.db
  }

  const set = async <T>(key: string, value: T): Promise<void> => {
    const db = getDb()

    return new Promise((resolve, reject) => {
      const tx = db.transaction('keys', 'readwrite')
      const store = tx.objectStore('keys')
      const request = store.put(value, key)

      request.onsuccess = () => resolve()
      request.onerror = () =>
        reject(new Error(request.error?.message || 'Storage operation failed'))
    })
  }

  const get = async <T>(key: string): Promise<T | undefined> => {
    const db = getDb()

    return new Promise((resolve, reject) => {
      const tx = db.transaction('keys', 'readonly')
      const store = tx.objectStore('keys')
      const request = store.get(key)

      request.onsuccess = () => resolve(request.result)
      request.onerror = () =>
        reject(new Error(request.error?.message || 'Storage retrieval failed'))
    })
  }

  const deleteKey = async (key: string): Promise<void> => {
    const db = getDb()

    return new Promise((resolve, reject) => {
      const tx = db.transaction('keys', 'readwrite')
      const store = tx.objectStore('keys')
      const request = store.delete(key)

      request.onsuccess = () => resolve()
      request.onerror = () => reject(new Error(request.error?.message || 'Storage deletion failed'))
    })
  }

  const close = () => {
    const connection = dbConnections.get(dbName)
    if (!connection) return

    connection.refCount--

    // Only close the database when no more references exist
    if (connection.refCount <= 0) {
      connection.db.close()
      dbConnections.delete(dbName)
    }
  }

  const destroy = async (): Promise<void> => {
    // First close this connection
    close()

    // Check if there are still other connections
    const connection = dbConnections.get(dbName)
    if (connection && connection.refCount > 0) {
      throw new Error(
        `Cannot delete database: ${connection.refCount} connection(s) still open. Close all sessions first.`,
      )
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

  return { init, set, get, delete: deleteKey, close, destroy }
}

// ===================================================================================
//  MAIN IMPLEMENTATION
// ===================================================================================

export async function createCryptoSession(accountId: string) {
  const storageNamespace = 'ty_ucs_' + accountId

  // Initialize storage
  const storage = createKeyStorage(storageNamespace)
  await storage.init()

  let isDestroyed = false

  const checkNotDestroyed = () => {
    if (isDestroyed) throw new Error('Session has been destroyed')
  }

  const destroy = () => {
    if (isDestroyed) return
    isDestroyed = true
    storage.close() // Close connection, don't delete database
  }

  // Key identifiers
  const DEVICE_KEYPAIR_KEY = 'deviceKeyPair'
  const SESSION_KEY_WRAPPED = 'sessionKeyWrapped'
  const USER_PUBLIC_KEY = 'userPublicKey'

  // Initialize device key pair
  const initDeviceKey = async () => {
    checkNotDestroyed()
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

  const getWrappedSessionKey = async () => {
    checkNotDestroyed()
    return await storage.get<string>(SESSION_KEY_WRAPPED)
  }

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
    checkNotDestroyed()
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
    checkNotDestroyed()
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
    checkNotDestroyed()
    if (!sessionKey) throw new Error('Session not initialized')
    return sessionKey
  }

  const exportSessionKey = async (shareKey: CryptoKeyPair) => {
    checkNotDestroyed()
    const kek = await deriveKek(deviceKeyPair.privateKey, deviceKeyPair.publicKey)
    const shareKek = await deriveKek(shareKey.privateKey, shareKey.publicKey)

    const wrappedSessionKey = await getWrappedSessionKey()
    if (!wrappedSessionKey) throw new Error('no wrappedSessionKey available to export!')
    return await reWrapSessionKey(wrappedSessionKey, kek, shareKek)
  }

  const getDevicePublicKey = (): CryptoKey => {
    checkNotDestroyed()
    if (!deviceKeyPair) throw new Error('Device key pair not initialized')
    return deviceKeyPair.publicKey
  }

  const getUserPublicKey = () => {
    checkNotDestroyed()
    if (!userKeyPair) throw new Error('User key pair not initialized')
    return userKeyPair
  }

  const regenerateSessionKey = () => {
    checkNotDestroyed()
    return initSessionKey(deviceKeyPair, { renew: true, persist: true })
  }

  const addWrappedSessionKey = async (exchangeKey: CryptoKeyPair, newKey: string) => {
    checkNotDestroyed()
    return await initSessionKey(deviceKeyPair, {
      renew: true,
      externalWrappedSessionKey: newKey,
      oldDeviceKeyPair: exchangeKey,
      persist: true,
    })
  }

  const regenerateDeviceKey = async (): Promise<void> => {
    checkNotDestroyed()
    const oldDeviceKeyPair = deviceKeyPair
    deviceKeyPair = await generateAssymetricKeyDeriver()
    await storage.set(DEVICE_KEYPAIR_KEY, deviceKeyPair)
    await initSessionKey(deviceKeyPair, { oldDeviceKeyPair, persist: true })
  }

  return {
    getSessionKey, // this is OK, because the key is non-exportable...
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

// ===================================================================================
//  UTILITY FUNCTIONS FOR COMPLETE DATABASE CLEANUP
// ===================================================================================

/**
 * Force closes all database connections and deletes the database
 * Use this for testing cleanup or when you need to completely reset
 */
export async function forceDestroyCryptoSession(accountId: string): Promise<void> {
  const storageNamespace = 'ty_ucs_' + accountId
  const dbName = `CryptoSession_${storageNamespace}`

  // Force close any existing connections
  const connection = dbConnections.get(dbName)
  if (connection) {
    connection.db.close()
    dbConnections.delete(dbName)
  }

  // Wait a bit for connections to close
  await new Promise((resolve) => setTimeout(resolve, 10))

  return new Promise((resolve, reject) => {
    const request = indexedDB.deleteDatabase(dbName)
    request.onsuccess = () => resolve()
    request.onerror = () => reject(new Error(request.error?.message || 'Database deletion failed'))
    request.onblocked = () => {
      // If still blocked, wait and try again
      setTimeout(() => {
        const retryRequest = indexedDB.deleteDatabase(dbName)
        retryRequest.onsuccess = () => resolve()
        retryRequest.onerror = () => reject(new Error('Database deletion failed on retry'))
        retryRequest.onblocked = () => reject(new Error('Database deletion permanently blocked'))
      }, 100)
    }
  })
}
