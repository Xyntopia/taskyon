import { base64UrlToUint8Array, uint8ArrayToBase64Url, urlSafe64BitString } from './encoding'
import { Buffer } from 'buffer'

/**
 * Generates a secure random recovery key.
 * This key is our “master key” that can be used for recovery.
 */
export function generateRecoveryKey(): Uint8Array {
  const key = new Uint8Array(32)
  crypto.getRandomValues(key)
  return key
}

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

export async function encryptObject(
  obj: unknown,
  key: CryptoKey,
): Promise<{ iv: string; ciphertext: string }> {
  const plainText = JSON.stringify(obj)
  // For AES-GCM, a 12-byte IV is recommended.
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const enc = new TextEncoder()
  const ciphertextBuffer = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    enc.encode(plainText),
  )
  return {
    iv: uint8ArrayToBase64Url(iv),
    ciphertext: uint8ArrayToBase64Url(new Uint8Array(ciphertextBuffer)),
  }
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
  return uint8ArrayToBase64Url(array)
}
// Example helper for generating a salt in both implementations.
