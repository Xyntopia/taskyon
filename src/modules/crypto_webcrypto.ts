import { base64UrlToUint8Array, uint8ArrayToBase64Url, urlSafe64BitString } from './encoding'
import { Buffer } from 'buffer'
import { z } from 'zod'

export function parseJwt(token: string | undefined): Record<string, unknown> | undefined {
  if (token) {
    const base64Url = token.split('.')[1]!
    const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/')
    const jsonPayload: string = decodeURIComponent(
      window
        .atob(base64)
        .split('')
        .map(function (c) {
          return '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2)
        })
        .join(''),
    )

    const jwtObject = JSON.parse(jsonPayload) as Record<string, unknown>
    return jwtObject
  }
}

// Generate a random key (256 bits) for HKDF
export async function generateRandomEncryptionKey(extractable = false): Promise<CryptoKey> {
  const keyBytes = crypto.getRandomValues(new Uint8Array(32)) // 32 bytes = 256 bits
  // using random values like the following doesn't work for keys as
  // KDF derived keys are not allowed to be extracted by default browser policy
  // thats why we are using the key generation function directly...
  //return crypto.subtle.importKey('raw', keyBytes, { name: 'HKDF' }, extractable, ['deriveKey'])
  return crypto.subtle.importKey(
    'raw',
    keyBytes,
    { name: 'AES-GCM', length: 256 },
    extractable,
    ['encrypt'], // Usage required for import, though not directly used
  )
}

export async function deriveKey(
  sessionKey: CryptoKey,
  salt: string,
  id: string,
): Promise<CryptoKey> {
  // Combine the salt and id to derive a per-record key.
  const enc = new TextEncoder()
  const combinedSalt = enc.encode(salt + id)
  return crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: combinedSalt,
      iterations: 100000,
      hash: 'SHA-256',
    },
    sessionKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  )
}

// Define a type for the encrypted data structure
export const EncryptedDataRow = z.object({
  iv: z.string(),
  ciphertext: z.string(),
  salt: z.string(),
  encryptedToolKey: z.string(),
  recoveryEncryptedToolKey: z.string(),
})
export type EncryptedDataRow = z.infer<typeof EncryptedDataRow>

export const EncryptedDataRowMixed = z.object({
  iv: z.instanceof(Uint8Array),
  ciphertext: z.instanceof(Uint8Array),
  salt: z.instanceof(Uint8Array),
  encryptedToolKey: z.string(),
  recoveryEncryptedToolKey: z.string(),
})
export type EncryptedDataRowMixed = z.infer<typeof EncryptedDataRowMixed>

async function encryptObject<T>(
  rowKey: CryptoKey,
  data: T,
  id: string | number,
): Promise<{ iv: string; ciphertext: string; salt: string }>

async function encryptObject<T>(
  rowKey: CryptoKey,
  data: T,
  id: string | number,
  base64: true,
): Promise<{ iv: string; ciphertext: string; salt: string }>

async function encryptObject<T>(
  rowKey: CryptoKey,
  data: T,
  id: string | number,
  base64: false,
): Promise<{ iv: Uint8Array; ciphertext: Uint8Array; salt: Uint8Array }>

// Encrypt object with key derived from rowKey + salt + id
async function encryptObject(
  rowKey: CryptoKey,
  data: BufferSource,
  id: string | number,
  base64: boolean = true,
) {
  const salt = crypto.getRandomValues(new Uint8Array(16))
  const info = new TextEncoder().encode(String(id))

  // Export rowKey as raw bytes and import as HKDF key
  const rawRowKey = await crypto.subtle.exportKey('raw', rowKey)
  const hkdfKey = await crypto.subtle.importKey('raw', rawRowKey, { name: 'HKDF' }, false, [
    'deriveKey',
  ])

  // Derive AES-GCM key using HKDF
  const derivedKey = await crypto.subtle.deriveKey(
    { name: 'HKDF', salt, info, hash: 'SHA-256' },
    hkdfKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt'],
  )

  // Encrypt data with derived key
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const encrypted = new Uint8Array(
    await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, derivedKey, data),
  )

  if (base64)
    return {
      iv: uint8ArrayToBase64Url(iv.buffer),
      ciphertext: uint8ArrayToBase64Url(encrypted.buffer),
      salt: uint8ArrayToBase64Url(salt.buffer),
    }
  else
    return {
      iv: iv,
      ciphertext: encrypted,
      salt: salt,
    } as { iv: Uint8Array; ciphertext: Uint8Array; salt: Uint8Array }
}

export type AskSession = () => Promise<CryptoKey> | CryptoKey

export async function encryptDataFile(
  data: BufferSource,
  info: string | number,
  publicRecoveryKey: AskSession,
  getSessionKey: AskSession,
): Promise<EncryptedDataRow>

export async function encryptDataFile(
  data: BufferSource,
  info: string | number,
  publicRecoveryKey: AskSession,
  getSessionKey: AskSession,
  base64: true,
): Promise<EncryptedDataRow>

export async function encryptDataFile(
  data: BufferSource,
  info: string | number,
  publicRecoveryKey: AskSession,
  getSessionKey: AskSession,
  base64: false,
): Promise<EncryptedDataRowMixed>

export async function encryptDataFile(
  data: BufferSource,
  info: string | number, // we need the info in order to derive the key with some additional noise
  // this should be a public key that can be used to encrypt the tool key
  publicRecoveryKey: AskSession,
  // and this is the session key provider. This is used to encryp the tool key
  // this way we never have to use the private recovery key anywhere. Except if we
  // want to recover the data...
  // The session key is a symmetric key. We usually save this key in the browser
  // in a secure storage.
  getSessionKey: AskSession,
  base64: boolean = true, // whether to return the data as base64 strings
) {
  // Generate a new random tool key for each set operation
  // we need the key to be extractable, so that we can encrypt it !
  const rowKey = await generateRandomEncryptionKey(true)

  // Encrypt the tool key using the recovery public key
  const recoveryEncryptedToolKey = await wrapKeyWithPublicKey(await publicRecoveryKey(), rowKey)

  const sessionKey = await getSessionKey() // Encrypt the tool key using the symmetric session key
  const encryptedToolKey = await encryptWithSessionKey(sessionKey, rowKey)

  // Encrypt the data using the tool key
  if (base64) {
    const { iv, ciphertext, salt } = await encryptObject(rowKey, data, info, base64)
    return {
      iv,
      ciphertext,
      salt,
      encryptedToolKey,
      recoveryEncryptedToolKey,
    } as EncryptedDataRow
  } else {
    const { iv, ciphertext, salt } = await encryptObject(rowKey, data, info, base64)
    return {
      iv,
      ciphertext,
      salt,
      encryptedToolKey,
      recoveryEncryptedToolKey,
    } as EncryptedDataRowMixed
  }
}

export const decryptDataFile = async (
  encData: EncryptedDataRow | EncryptedDataRowMixed,
  // the info is used to derive the key with some additional noise
  // this is usually the record ID or some other identifier which is unique for the record
  // and not encrypted...
  info: string | number,
  getSessionKey: AskSession,
) => {
  // Decrypt the tool key using the symmetric session key (this is always a string)
  const rowKey = await decryptWithSessionKey(await getSessionKey(), encData.encryptedToolKey)

  // Decrypt the data using the tool key. The updated `decryptData` function
  // will handle the type detection internally. No `if` block needed here!
  const data = await decryptData(rowKey, encData.iv, encData.ciphertext, encData.salt, info)
  return data
}

export async function importEd25519PublicKeyFromBase64(base64Key: string): Promise<CryptoKey> {
  const publicKey = base64UrlToUint8Array(base64Key)
  return crypto.subtle.importKey('raw', publicKey, { name: 'Ed25519' }, true, ['verify'])
}

export async function generateECDSAKeyPair(): Promise<{
  publicKey: CryptoKey
  privateKey: CryptoKey
}> {
  const keyPair = await crypto.subtle.generateKey(
    {
      name: 'ECDSA',
      namedCurve: 'P-256',
    },
    true, // extractable keys
    ['sign', 'verify'],
  )

  return {
    publicKey: keyPair.publicKey,
    privateKey: keyPair.privateKey,
  }
}

export async function generateRsaOaepPair(): Promise<{
  publicKey: CryptoKey
  privateKey: CryptoKey
}> {
  // Generate an RSA-OAEP key pair for encryption:
  const keyPair = await crypto.subtle.generateKey(
    {
      name: 'RSA-OAEP',
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: 'SHA-256',
    },
    true, // extractable
    ['encrypt', 'decrypt'],
  )

  return {
    publicKey: keyPair.publicKey,
    privateKey: keyPair.privateKey,
  }
}

export async function wrapKeyWithPublicKey(
  publicKey: CryptoKey,
  dataKey: CryptoKey,
): Promise<string> {
  const rawKey = await crypto.subtle.exportKey('raw', dataKey)
  const encrypted = await crypto.subtle.encrypt({ name: 'RSA-OAEP' }, publicKey, rawKey)
  return uint8ArrayToBase64Url(encrypted)
}

export async function encryptWithSessionKey(
  sessionKey: CryptoKey,
  dataKey: CryptoKey,
): Promise<string> {
  const rawKey = await crypto.subtle.exportKey('raw', dataKey)
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, sessionKey, rawKey)

  const combined = new Uint8Array([...iv, ...new Uint8Array(encrypted)])
  return uint8ArrayToBase64Url(combined.buffer)
}

export async function decryptWithSessionKey(
  sessionKey: CryptoKey,
  encryptedData: string,
): Promise<CryptoKey> {
  const combined = base64UrlToUint8Array(encryptedData)
  const iv = combined.slice(0, 12)
  const ciphertext = combined.slice(12)

  const rawKey = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, sessionKey, ciphertext)

  return crypto.subtle.importKey('raw', rawKey, { name: 'HKDF' }, false, ['deriveKey'])
}

// Decrypt data using derived key
export async function decryptData(
  rowKey: CryptoKey,
  iv: string | Uint8Array,
  ciphertext: string | Uint8Array,
  salt: string | Uint8Array,
  id: string | number,
) {
  // --- START OF CHANGES ---
  // Use `typeof` to check if the inputs are strings. If so, decode them.
  // If they are already ArrayBuffers, use them as is.
  const ivBytes = typeof iv === 'string' ? base64UrlToUint8Array(iv) : iv
  const ciphertextBytes =
    typeof ciphertext === 'string' ? base64UrlToUint8Array(ciphertext) : ciphertext
  const saltBytes = typeof salt === 'string' ? base64UrlToUint8Array(salt) : salt
  // --- END OF CHANGES ---

  const info = new TextEncoder().encode(String(id))

  const derivedKey = await crypto.subtle.deriveKey(
    {
      name: 'HKDF',
      salt: saltBytes, // Now correctly using a buffer
      info,
      hash: 'SHA-256',
    },
    rowKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['decrypt'],
  )

  const decrypted = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: ivBytes }, // Now correctly using a buffer
    derivedKey,
    ciphertextBytes, // Now correctly using a buffer
  )

  return new Uint8Array(decrypted)
}

export async function decryptObject(
  { iv, ciphertext }: { iv: string; ciphertext: string },
  key: CryptoKey,
): Promise<unknown> {
  const ivArray = base64UrlToUint8Array(iv)
  const ctArray = base64UrlToUint8Array(ciphertext)
  const decryptedBuffer = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: ivArray },
    key,
    ctArray,
  )
  const dec = new TextDecoder()
  return JSON.parse(dec.decode(decryptedBuffer))
}

// Auto-detect the crypto backend
export function detectCryptoBackend() {
  return typeof window !== 'undefined' && window.crypto && window.crypto.subtle ? 'web' : 'js'
}

export async function sha256UrlSafeHash(obj: unknown) {
  const json = JSON.stringify(obj)
  const encoder = new TextEncoder()
  const data = encoder.encode(json)

  const hashBuffer = await crypto.subtle.digest('SHA-256', data)
  return urlSafe64BitString(Buffer.from(hashBuffer))
}

export async function charHash(
  obj: unknown,
  maxLength?: number,
  chars: string = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789',
): Promise<string> {
  const json = JSON.stringify(obj)
  const encoder = new TextEncoder()
  const data = encoder.encode(json)

  const hashBuffer = await crypto.subtle.digest('SHA-256', data)
  const hashArray = Array.from(new Uint8Array(hashBuffer))

  const base = chars.length
  const targetLength = maxLength ?? hashArray.length
  const result = new Array<string>(targetLength)

  let i = 0
  for (const byte of hashArray) {
    if (i >= targetLength) break
    result[i++] = chars[byte % base]!
  }

  return result.join('')
}

export function generateSalt(): string {
  const array = new Uint8Array(16)
  crypto.getRandomValues(array)
  return uint8ArrayToBase64Url(array.buffer)
}
// Example helper for generating a salt in both implementations.
