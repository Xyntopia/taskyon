// browserDeviceKey.ts

import type { CryptoSessionOptions } from '@taskyon/taskyon'
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
export const createBrowserCryptoSession = async (
  sessionName: string,
  options?: Omit<CryptoSessionOptions, 'DK'>,
) => {
  // TODO: deal with duplicate sesson IDs, e.g. because of same password...
  //       if this is the case, we would like to add a salt...  and also use the salt
  //       to identify the relevant session id...
  //
  let wrappedSK = LocalStorage.getItem(sessionName) as string

  const DK = await getDeviceKey(storageNamespace)
  const cs = await createCryptoSession({ ...options, deviceKeyPair: DK, wrappedSK })
  // in case cs creates a new devicekey, store it here :)
  if (!DK) await setDeviceKey(storageNamespace, cs.getDeviceKey())
  if (!wrappedSK) {
    wrappedSK = await cs.exportSessionKey()
    LocalStorage.setItem(sessionName, wrappedSK)
  }

  return cs
}

export const deleteSession = (sessionName: string) => {
  LocalStorage.remove(sessionName)
}
