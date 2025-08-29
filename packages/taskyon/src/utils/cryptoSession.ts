/**
 * @file useCryptoSession.ts
 * @description Complete crypto session management with key lifecycle, persistence, and sharing
 */

// ===================================================================================
//  TYPE DEFINITIONS
// ===================================================================================

export interface CryptoSessionOptions {
  deviceId?: string
  accountId?: string
  jwtPayload?: Record<string, unknown>
  mnemonic?: string
  passphrase?: string
}

interface WrappedEnvelope {
  v: number
  alg: string
  epkJwk: JsonWebKey
  ct: string
  iv?: string
  meta?: Record<string, unknown>
}

// ===================================================================================
//  UTILITY FUNCTIONS
// ===================================================================================

const enc = new TextEncoder()
const dec = new TextDecoder()

function bufToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer)
  let binary = ''
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode.apply(null, Array.from(bytes.slice(i, i + 0x8000)))
  }
  return btoa(binary)
}

function base64ToBuf(base64: string): ArrayBuffer {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i)
  }
  return bytes.buffer
}

// ===================================================================================
//  INDEXEDDB PERSISTENCE (FUNCTIONAL)
// ===================================================================================

function createStorage(namespace: string) {
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

  return { init, set, get, delete: deleteKey }
}

// ===================================================================================
//  CRYPTO UTILITIES
// ===================================================================================

const CryptoUtils = {
  async generateSessionKey(): Promise<CryptoKey> {
    return crypto.subtle.generateKey(
      { name: 'AES-GCM', length: 256 },
      false, // non-extractable
      ['encrypt', 'decrypt'],
    )
  },

  async generateDeviceKeyPair(): Promise<CryptoKeyPair> {
    return crypto.subtle.generateKey(
      { name: 'ECDH', namedCurve: 'P-256' },
      false, // non-extractable private key
      ['deriveKey', 'deriveBits'],
    )
  },

  async generateUserKeyPair(): Promise<CryptoKeyPair> {
    const keys = await crypto.subtle.generateKey(
      { name: 'Ed25519' },
      true, // extractable for memory management
      ['sign', 'verify'],
    )
    return keys as unknown as CryptoKeyPair
  },

  async deriveKek(privateKey: CryptoKey, publicKey: CryptoKey): Promise<CryptoKey> {
    return crypto.subtle.deriveKey(
      { name: 'ECDH', public: publicKey },
      privateKey,
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt', 'decrypt', 'wrapKey', 'unwrapKey'],
    )
  },

  async wrapSessionKey(sessionKey: CryptoKey, kek: CryptoKey): Promise<ArrayBuffer> {
    // First export session key to raw format
    const sessionRaw = await crypto.subtle.exportKey('raw', sessionKey)

    const iv = crypto.getRandomValues(new Uint8Array(12))
    const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, kek, sessionRaw)

    // Prepend IV to encrypted data
    const result = new Uint8Array(iv.length + encrypted.byteLength)
    result.set(iv, 0)
    result.set(new Uint8Array(encrypted), iv.length)

    return result.buffer
  },

  async unwrapSessionKey(wrappedData: ArrayBuffer, kek: CryptoKey): Promise<CryptoKey> {
    const data = new Uint8Array(wrappedData)
    const iv = data.slice(0, 12)
    const encrypted = data.slice(12)

    const decrypted = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, kek, encrypted)

    return crypto.subtle.importKey(
      'raw',
      decrypted,
      { name: 'AES-GCM' },
      false, // non-extractable
      ['encrypt', 'decrypt'],
    )
  },

  generateDeviceId(): string {
    return crypto.randomUUID()
  },
}

// ===================================================================================
//  MAIN IMPLEMENTATION
// ===================================================================================

export async function createCryptoSession(options: CryptoSessionOptions = {}) {
  // Generate unique identifiers
  const deviceId = options.deviceId || CryptoUtils.generateDeviceId()
  const storageNamespace = options.accountId ? `${options.accountId}_${deviceId}` : deviceId

  // Initialize storage
  const storage = createStorage(storageNamespace)
  await storage.init()

  // Internal state
  let sessionKey: CryptoKey | null = null
  let deviceKeyPair: CryptoKeyPair | null = null
  let userKeyPair: CryptoKeyPair | null = null

  // Key identifiers
  const DEVICE_KEYPAIR_KEY = 'deviceKeyPair'
  const SESSION_KEY_WRAPPED = 'sessionKeyWrapped'
  const USER_PUBLIC_KEY = 'userPublicKey'

  // Initialize device key pair
  const initDeviceKey = async (): Promise<void> => {
    try {
      // Try to load existing device key pair from storage
      const stored = await storage.get<CryptoKeyPair>(DEVICE_KEYPAIR_KEY)
      if (stored && stored.privateKey && stored.publicKey) {
        deviceKeyPair = stored
        return
      }
    } catch {
      // Fallback to generating new key pair
    }

    // Generate new device key pair
    deviceKeyPair = await CryptoUtils.generateDeviceKeyPair()

    // Attempt to store (may fail if browser doesn't support storing CryptoKey)
    try {
      await storage.set(DEVICE_KEYPAIR_KEY, deviceKeyPair)
    } catch {
      console.warn('Failed to persist device key pair - will work in memory only')
    }
  }

  // Initialize session key
  const initSessionKey = async (): Promise<void> => {
    if (!deviceKeyPair) throw new Error('Device key pair must be initialized first')

    // Try to load wrapped session key
    try {
      const wrapped = await storage.get<ArrayBuffer>(SESSION_KEY_WRAPPED)
      if (wrapped) {
        const kek = await CryptoUtils.deriveKek(deviceKeyPair.privateKey, deviceKeyPair.publicKey)
        sessionKey = await CryptoUtils.unwrapSessionKey(wrapped, kek)
        return
      }
    } catch {
      // Fallback to generating new session key
    }

    // Generate new session key
    sessionKey = await CryptoUtils.generateSessionKey()

    // Wrap and store session key
    const kek = await CryptoUtils.deriveKek(deviceKeyPair.privateKey, deviceKeyPair.publicKey)
    const wrapped = await CryptoUtils.wrapSessionKey(sessionKey, kek)
    await storage.set(SESSION_KEY_WRAPPED, wrapped)
  }

  // Initialize user key pair
  const initUserKey = async (): Promise<void> => {
    if (options.mnemonic) {
      // TODO: Implement mnemonic-based key derivation
      console.warn('Mnemonic support not yet implemented, generating random key')
    }

    // Generate user key pair (always new, in memory only)
    userKeyPair = await CryptoUtils.generateUserKeyPair()

    // Store public key for reference
    const publicKeyBytes = await crypto.subtle.exportKey('raw', userKeyPair.publicKey)
    await storage.set(USER_PUBLIC_KEY, publicKeyBytes)
  }

  // Initialize all components
  await initDeviceKey()
  await initSessionKey()
  await initUserKey()

  // Public interface
  const getSessionKey = (): CryptoKey => {
    if (!sessionKey) throw new Error('Session not initialized')
    return sessionKey
  }

  const getDevicePublicKey = (): CryptoKey => {
    if (!deviceKeyPair) throw new Error('Device key pair not initialized')
    return deviceKeyPair.publicKey
  }

  const getUserPublicKeyBytes = async (): Promise<Uint8Array> => {
    if (!userKeyPair) throw new Error('User key pair not initialized')
    const exported = await crypto.subtle.exportKey('raw', userKeyPair.publicKey)
    return new Uint8Array(exported)
  }

  const wrapSessionKey = async (targetPublicKey: CryptoKey): Promise<Uint8Array> => {
    if (!sessionKey || !deviceKeyPair) throw new Error('Session not ready')

    // Generate ephemeral key pair for this operation
    const ephemeral = await CryptoUtils.generateDeviceKeyPair()

    // Derive KEK using ephemeral private and target public
    const kek = await CryptoUtils.deriveKek(ephemeral.privateKey, targetPublicKey)

    // Export session key and wrap it
    const sessionRaw = await crypto.subtle.exportKey('raw', sessionKey)
    const iv = crypto.getRandomValues(new Uint8Array(12))
    const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, kek, sessionRaw)

    // Create envelope with ephemeral public key
    const ephemeralPublicJwk = await crypto.subtle.exportKey('jwk', ephemeral.publicKey)
    const envelope: WrappedEnvelope = {
      v: 1,
      alg: 'ECDH-P256+AES-GCM',
      epkJwk: ephemeralPublicJwk,
      ct: bufToBase64(encrypted),
      iv: bufToBase64(iv.buffer),
    }

    return enc.encode(JSON.stringify(envelope))
  }

  const unwrapSessionKey = async (wrappedKey: Uint8Array): Promise<CryptoKey> => {
    if (!deviceKeyPair) throw new Error('Device key pair not ready')

    const envelopeStr = dec.decode(wrappedKey)
    const envelope: WrappedEnvelope = JSON.parse(envelopeStr)

    // Import ephemeral public key
    const ephemeralPublic = await crypto.subtle.importKey(
      'jwk',
      envelope.epkJwk,
      { name: 'ECDH', namedCurve: 'P-256' },
      false,
      [],
    )

    // Derive same KEK using our private key and sender's ephemeral public
    const kek = await CryptoUtils.deriveKek(deviceKeyPair.privateKey, ephemeralPublic)

    // Decrypt session key
    const iv = new Uint8Array(base64ToBuf(envelope.iv!))
    const encrypted = base64ToBuf(envelope.ct)
    const decrypted = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, kek, encrypted)

    // Import as new session key
    const newSessionKey = await crypto.subtle.importKey(
      'raw',
      decrypted,
      { name: 'AES-GCM' },
      false,
      ['encrypt', 'decrypt'],
    )

    sessionKey = newSessionKey

    // Persist the new session key
    if (deviceKeyPair) {
      const persistKek = await CryptoUtils.deriveKek(
        deviceKeyPair.privateKey,
        deviceKeyPair.publicKey,
      )
      const wrapped = await CryptoUtils.wrapSessionKey(sessionKey, persistKek)
      await storage.set(SESSION_KEY_WRAPPED, wrapped)
    }

    return sessionKey
  }

  const regenerateSessionKey = async (): Promise<void> => {
    sessionKey = await CryptoUtils.generateSessionKey()

    if (deviceKeyPair) {
      const kek = await CryptoUtils.deriveKek(deviceKeyPair.privateKey, deviceKeyPair.publicKey)
      const wrapped = await CryptoUtils.wrapSessionKey(sessionKey, kek)
      await storage.set(SESSION_KEY_WRAPPED, wrapped)
    }
  }

  const regenerateDeviceKey = async (): Promise<void> => {
    deviceKeyPair = await CryptoUtils.generateDeviceKeyPair()

    try {
      await storage.set(DEVICE_KEYPAIR_KEY, deviceKeyPair)
    } catch {
      console.warn('Failed to persist new device key pair - will work in memory only')
    }

    // Re-wrap session key with new device key
    if (sessionKey) {
      const kek = await CryptoUtils.deriveKek(deviceKeyPair.privateKey, deviceKeyPair.publicKey)
      const wrapped = await CryptoUtils.wrapSessionKey(sessionKey, kek)
      await storage.set(SESSION_KEY_WRAPPED, wrapped)
    }
  }

  const regenerateUserKey = async (): Promise<void> => {
    userKeyPair = await CryptoUtils.generateUserKeyPair()

    const publicKeyBytes = await crypto.subtle.exportKey('raw', userKeyPair.publicKey)
    await storage.set(USER_PUBLIC_KEY, publicKeyBytes)
  }

  const logout = async (clearPersistentStorage = false): Promise<void> => {
    // Zeroize memory references
    sessionKey = null
    deviceKeyPair = null
    userKeyPair = null

    if (clearPersistentStorage) {
      await Promise.allSettled([
        storage.delete(DEVICE_KEYPAIR_KEY),
        storage.delete(SESSION_KEY_WRAPPED),
        storage.delete(USER_PUBLIC_KEY),
      ])
    }
  }

  const exportDevicePublicKeyJwk = async (): Promise<JsonWebKey> => {
    if (!deviceKeyPair) throw new Error('Device key pair not initialized')
    return crypto.subtle.exportKey('jwk', deviceKeyPair.publicKey)
  }

  const getDeviceId = (): string => deviceId

  return {
    getSessionKey,
    getDevicePublicKey,
    getUserPublicKeyBytes,
    wrapSessionKey,
    unwrapSessionKey,
    regenerateSessionKey,
    regenerateDeviceKey,
    regenerateUserKey,
    logout,
    exportDevicePublicKeyJwk,
    getDeviceId,
  }
}
