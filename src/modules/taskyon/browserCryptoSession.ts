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
  const fromFallback = async () => {
    const fallback = await getDeviceKeyFromFallbackStorage(namespace)
    if (fallback) return fallback
    return undefined
  }

  const db = await openDatabase(namespace)

  try {
    const value = await new Promise<unknown>((resolve, reject) => {
      const tx = db.transaction('keys', 'readonly')
      const store = tx.objectStore('keys')
      const request = store.get('deviceKeyPair')

      request.onsuccess = () => resolve(request.result)
      request.onerror = () =>
        reject(new Error(request.error?.message || 'Failed to get device key'))
    })
    if (isUsableX25519KeyPair(value)) return value
    return await fromFallback()
  } catch {
    return await fromFallback()
  } finally {
    db.close()
  }
}

async function setDeviceKey(namespace: string, keyPair: CryptoKeyPair): Promise<void> {
  await saveDeviceKeyToFallbackStorage(namespace, keyPair)
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

const wrappedKeyPrefix = 'sk_'
const storageNamespace = 'ty_device_key'
const fallbackDeviceKeyPrefix = 'x25519_jwk_'

function isLikelyTauriRuntime() {
  if (typeof window === 'undefined') return false
  const w = window as Window & {
    __TAURI_INTERNALS__?: unknown
    __TAURI_IPC__?: unknown
  }
  if (typeof w.__TAURI_INTERNALS__ !== 'undefined') return true
  if (typeof w.__TAURI_IPC__ !== 'undefined') return true
  const ua = window.navigator.userAgent || ''
  return ua.includes('Tauri')
}

function fallbackDeviceKeyStorageKey(namespace: string) {
  return `${fallbackDeviceKeyPrefix}${namespace}`
}

function isUsableX25519KeyPair(value: unknown): value is CryptoKeyPair {
  if (!value || typeof value !== 'object') return false
  const privateKey = (value as { privateKey?: unknown }).privateKey
  const publicKey = (value as { publicKey?: unknown }).publicKey
  if (!(privateKey instanceof CryptoKey) || !(publicKey instanceof CryptoKey)) return false
  return privateKey.type === 'private' && publicKey.type === 'public'
}

type PersistedX25519Jwk = {
  privateJwk: JsonWebKey
  publicJwk: JsonWebKey
}

async function exportDeviceKeyToJwk(
  keyPair: CryptoKeyPair,
): Promise<PersistedX25519Jwk | undefined> {
  if (!keyPair.privateKey.extractable || !keyPair.publicKey.extractable) return undefined
  const privateJwk = await crypto.subtle.exportKey('jwk', keyPair.privateKey)
  const publicJwk = await crypto.subtle.exportKey('jwk', keyPair.publicKey)
  return { privateJwk, publicJwk }
}

async function importDeviceKeyFromJwk(jwk: PersistedX25519Jwk): Promise<CryptoKeyPair> {
  const privateKey = await crypto.subtle.importKey(
    'jwk',
    jwk.privateJwk,
    { name: 'X25519' },
    false,
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

async function saveDeviceKeyToFallbackStorage(namespace: string, keyPair: CryptoKeyPair) {
  // We only use this in Tauri where IndexedDB CryptoKey roundtrips can be unreliable.
  if (!isLikelyTauriRuntime()) return
  const key = fallbackDeviceKeyStorageKey(namespace)
  const exported = await exportDeviceKeyToJwk(keyPair)
  if (!exported) return
  LocalStorage.setItem(key, JSON.stringify(exported))
}

async function getDeviceKeyFromFallbackStorage(
  namespace: string,
): Promise<CryptoKeyPair | undefined> {
  const key = fallbackDeviceKeyStorageKey(namespace)
  const raw = LocalStorage.getItem(key)
  if (typeof raw !== 'string' || !raw.trim()) return undefined
  try {
    const parsed = JSON.parse(raw) as PersistedX25519Jwk
    return await importDeviceKeyFromJwk(parsed)
  } catch (error) {
    console.warn('Invalid fallback device key format, clearing key cache', error)
    LocalStorage.removeItem(key)
    return undefined
  }
}

async function generatePersistableDeviceKeyPair(): Promise<CryptoKeyPair> {
  const keyPair = (await crypto.subtle.generateKey({ name: 'X25519' }, true, [
    'deriveKey',
    'deriveBits',
  ])) as CryptoKeyPair
  return keyPair
}

// in the browser we can permanently store the inital device key safely
// in indexeddb! We also store wrapped Session Keys safely in localstorage
export const initCryptoSessionFromBrowser = async (
  options?: CryptoSessionOptions,
  persist = false,
) => {
  let DK = await getDeviceKey(storageNamespace)
  if (!DK && persist && isLikelyTauriRuntime()) {
    DK = await generatePersistableDeviceKeyPair()
  }
  let cs = await createCryptoSession({ deviceKeyPair: DK, ...options })
  // in case cs creates a new devicekey, store it here :)
  if (persist) await setDeviceKey(storageNamespace, cs.getDeviceKey())

  // we create an id from the wrapper which we can
  // use to identify the correct wrapped session key!
  const sessionName = await cs.getWrapperId()
  if (!options?.wrappedSK) {
    // now check if we stored a SK before:
    const wrappedSK = LocalStorage.getItem(wrappedKeyPrefix + sessionName)
    // if we stored it before, we need to set it in the cryptosession:
    if (typeof wrappedSK === 'string') {
      cs = await cs.newSessionKey(wrappedSK)
    }
  }

  if (persist) await persistSession(cs)

  return cs
}

// persists a cryptosession to its corresponding local storage id..
export const persistSession = async (cs: CryptoSession) => {
  const sessionName = await cs.getWrapperId()
  const lastWrappedSK = await cs.exportSessionKey()
  LocalStorage.setItem(wrappedKeyPrefix + sessionName, lastWrappedSK)
}

export const deleteSession = async (session: CryptoSession) => {
  LocalStorage.remove(await session.getWrapperId())
}
