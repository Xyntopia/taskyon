/**
 * @file useCryptoSession.ts
 * @description Simplified crypto session management with minimal persistence
 */

import {
  keyPairFromMnemonic,
  generateAssymetricKeyDeriver,
  generateWrappedSessionKey,
  unwrapSessionKey,
  reWrapSessionKey,
  deriveKek,
  cryptoKeyToBase64,
} from './crypto'

// ===================================================================================
//  SIMPLIFIED INDEXEDDB OPERATIONS
// ===================================================================================

async function openDatabase(namespace: string): Promise<IDBDatabase> {
  const dbName = `CryptoSession_${namespace}`

  return new Promise((resolve, reject) => {
    const request = indexedDB.open(dbName, 1)

    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains('keys')) {
        db.createObjectStore('keys')
      }
    }

    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(new Error(request.error?.message || 'Database open failed'))
  })
}

async function getDeviceKey(namespace: string): Promise<CryptoKeyPair | undefined> {
  const db = await openDatabase(namespace)

  try {
    return new Promise((resolve, reject) => {
      const tx = db.transaction('keys', 'readonly')
      const store = tx.objectStore('keys')
      const request = store.get('deviceKeyPair')

      request.onsuccess = () => resolve(request.result)
      request.onerror = () =>
        reject(new Error(request.error?.message || 'Failed to get device key'))
    })
  } finally {
    db.close()
  }
}

async function setDeviceKey(namespace: string, keyPair: CryptoKeyPair): Promise<void> {
  const db = await openDatabase(namespace)

  try {
    return new Promise((resolve, reject) => {
      const tx = db.transaction('keys', 'readwrite')
      const store = tx.objectStore('keys')
      const request = store.put(keyPair, 'deviceKeyPair')

      request.onsuccess = () => resolve()
      request.onerror = () =>
        reject(new Error(request.error?.message || 'Failed to store device key'))
    })
  } finally {
    db.close()
  }
}

async function deleteDatabase(namespace: string): Promise<void> {
  const dbName = `CryptoSession_${namespace}`

  return new Promise((resolve, reject) => {
    const request = indexedDB.deleteDatabase(dbName)
    request.onsuccess = () => resolve()
    request.onerror = () => reject(new Error(request.error?.message || 'Database deletion failed'))
    request.onblocked = () => reject(new Error('Database deletion blocked'))
  })
}

type UserKeyPair = {
  privateKey: CryptoKey
  publicKey: CryptoKey
  pkb64: string
}

type CryptoSessionOptions = {
  wrappedSK?: string
  unwrapper?: CryptoKey
  mnemonic?: string
  userKeyPair?: UserKeyPair
  newDK?: boolean
}

// TODO: pass an old crypto session and convert our wrapped keys and everything to the "new" session..

export async function createCryptoSession(accountId: string, options?: CryptoSessionOptions) {
  const storageNamespace = 'ty_ucs_' + accountId

  // Initialize or load device key pair
  const existingDeviceKey = options?.newDK ? undefined : await getDeviceKey(storageNamespace)
  let deviceKeyPair: CryptoKeyPair
  if (!existingDeviceKey) {
    deviceKeyPair = await generateAssymetricKeyDeriver()
    await setDeviceKey(storageNamespace, deviceKeyPair)
  } else {
    deviceKeyPair = existingDeviceKey
  }
  const kek = await deriveKek(deviceKeyPair.privateKey, deviceKeyPair.publicKey)

  // Initialize session key (in memory only)
  const wrappedSK = options?.wrappedSK
    ? options?.unwrapper
      ? await reWrapSessionKey(options.wrappedSK, options.unwrapper, kek)
      : options.wrappedSK
    : await generateWrappedSessionKey(kek)
  const SK = await unwrapSessionKey(wrappedSK, kek)

  // Initialize user key pair (in memory only)
  const userKeyPair = options?.mnemonic
    ? await keyPairFromMnemonic(options.mnemonic)
    : options?.userKeyPair

  const exportSessionKey = async (shareKey?: CryptoKey) => {
    if (shareKey) {
      return await reWrapSessionKey(wrappedSK, kek, shareKey)
    } else {
      return wrappedSK
    }
  }

  return {
    getSessionKey: () => SK,
    getDevicePublicKey: () => deviceKeyPair.publicKey,
    id: () => cryptoKeyToBase64(deviceKeyPair.publicKey),
    getUserPublicKey: (): CryptoKey => {
      if (!userKeyPair) throw new Error('User key pair not initialized')
      return userKeyPair.publicKey
    },
    exportSessionKey,
    destroy: async () => await deleteDatabase(storageNamespace),
    derive: (options?: {
      newSK?: boolean
      wrappedSK?: string
      newDK?: boolean
      newMnemonic?: string
      unwrapper?: CryptoKey
    }) => {
      return createCryptoSession(accountId, {
        ...(options?.wrappedSK
          ? { wrappedSK: options.wrappedSK }
          : options?.newSK
            ? {}
            : { wrappedSK: wrappedSK }),
        unwrapper: options?.unwrapper ?? kek,
        newDK: !!options?.newDK,
        ...(userKeyPair ? { userKeyPair } : {}),
        ...(options?.newMnemonic ? { mnemonic: options?.newMnemonic } : {}),
      })
    },
  }
}

export type CryptoSession = Awaited<ReturnType<typeof createCryptoSession>>

/**
 * Completely deletes the crypto session database for an account
 */
export async function forceDestroyCryptoSession(accountId: string): Promise<void> {
  const storageNamespace = 'ty_ucs_' + accountId
  await deleteDatabase(storageNamespace)
}
