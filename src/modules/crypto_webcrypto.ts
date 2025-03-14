import { base64UrlToUint8Array, uint8ArrayToBase64Url, urlSafe64BitString } from './encoding'
import { Buffer } from 'buffer'

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
export async function generateRandomKey(): Promise<CryptoKey> {
  const keyBytes = crypto.getRandomValues(new Uint8Array(32))
  return crypto.subtle.importKey('raw', keyBytes, { name: 'HKDF' }, false, ['deriveKey'])
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

// Encrypt object with key derived from rowKey + salt + id
export async function encryptObject<T>(
  rowKey: CryptoKey,
  data: T,
  id: string | number,
): Promise<{ iv: string; ciphertext: string; salt: string }> {
  const salt = crypto.getRandomValues(new Uint8Array(16))
  const info = new TextEncoder().encode(String(id))

  // Derive AES-GCM key using HKDF
  const derivedKey = await crypto.subtle.deriveKey(
    {
      name: 'HKDF',
      salt,
      info,
      hash: 'SHA-256',
    },
    rowKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt'],
  )

  const iv = crypto.getRandomValues(new Uint8Array(12))
  const encrypted = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    derivedKey,
    new TextEncoder().encode(JSON.stringify(data)),
  )

  return {
    iv: uint8ArrayToBase64Url(iv.buffer),
    ciphertext: uint8ArrayToBase64Url(encrypted),
    salt: uint8ArrayToBase64Url(salt.buffer),
  }
}

// Encrypt rowKey with RSA-OAEP public key
export async function encryptWithPublicKey(
  publicKey: CryptoKey,
  dataKey: CryptoKey,
): Promise<string> {
  const rawKey = await crypto.subtle.exportKey('raw', dataKey)
  const encrypted = await crypto.subtle.encrypt({ name: 'RSA-OAEP' }, publicKey, rawKey)
  return uint8ArrayToBase64Url(encrypted)
}

// Encrypt rowKey with AES-GCM session key
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

// Decrypt rowKey with AES-GCM session key
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
  iv: string,
  ciphertext: string,
  salt: string,
  id: string | number,
) {
  const ivBytes = base64UrlToUint8Array(iv)
  const ciphertextBytes = base64UrlToUint8Array(ciphertext)
  const saltBytes = base64UrlToUint8Array(salt)
  const info = new TextEncoder().encode(String(id))

  const derivedKey = await crypto.subtle.deriveKey(
    {
      name: 'HKDF',
      salt: saltBytes,
      info,
      hash: 'SHA-256',
    },
    rowKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['decrypt'],
  )

  const decrypted = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: ivBytes },
    derivedKey,
    ciphertextBytes,
  )

  return JSON.parse(new TextDecoder().decode(decrypted))
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

export function generateSalt(): string {
  const array = new Uint8Array(16)
  crypto.getRandomValues(array)
  return uint8ArrayToBase64Url(array.buffer)
}
// Example helper for generating a salt in both implementations.
