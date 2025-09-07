// browserDeviceKey.ts

import type { CryptoSession, CryptoSessionOptions } from '@taskyon/taskyon'
import { createCryptoSession } from '@taskyon/taskyon'
import { LocalStorage } from 'quasar'

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

/*async function deleteDatabase(namespace: string): Promise<void> {
  const dbName = `CryptoSession_${namespace}`

  return new Promise((resolve, reject) => {
    const request = indexedDB.deleteDatabase(dbName)
    request.onsuccess = () => resolve()
    request.onerror = () => reject(new Error(request.error?.message || 'Database deletion failed'))
    request.onblocked = () => reject(new Error('Database deletion blocked'))
  })
}*/

const storageNamespace = 'ty_device_key'
// in the browser we can permanently store the inital device key safely
// in indexeddb! We also store wrapped Session Keys safely in localstorage
export const initCryptoSessionFromBrowser = async (
  options?: CryptoSessionOptions,
  persist = false,
) => {
  const DK = await getDeviceKey(storageNamespace)
  let cs = await createCryptoSession({ deviceKeyPair: DK, ...options })
  // in case cs creates a new devicekey, store it here :)
  if (!DK && persist) await setDeviceKey(storageNamespace, cs.getDeviceKey())

  // we create an id from the wrapper which we can
  // use to identify the correct wrapped session key!
  const sessionName = await cs.getWrapperId()
  if (!options?.wrappedSK) {
    // now check if we stored a SK before:
    const wrappedSK = LocalStorage.getItem(sessionName) as string | undefined
    // if we stored it before, we need to set it in the cryptosession:
    cs = await cs.newSessionKey(wrappedSK)
  }

  if (persist) {
    // always store the created session key
    const lastWrappedSK = await cs.exportSessionKey()
    LocalStorage.setItem(sessionName, lastWrappedSK)
  }

  return cs
}

export const persistSession = async (cs: CryptoSession) => {
  const sessionName = await cs.getWrapperId()
  const lastWrappedSK = await cs.exportSessionKey()
  LocalStorage.setItem(sessionName, lastWrappedSK)
}

export const deleteSession = async (session: CryptoSession) => {
  LocalStorage.remove(await session.getWrapperId())
}
