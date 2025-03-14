// crypto functions which don't depend on web crypto api from browsers

import { generateMnemonic, validateMnemonic, mnemonicToSeedSync } from '@scure/bip39'
import { wordlist as englishWordlist } from '@scure/bip39/wordlists/english'
import { signAsync, getPublicKeyAsync, verifyAsync } from '@noble/ed25519'
import { base64UrlToUint8Array, uint8ArrayToBase64Url, urlSafe64BitString } from './encoding'
import { v1 as uuidv1 } from 'uuid'
import { Buffer } from 'buffer'
import { pbkdf2 } from '@noble/hashes/pbkdf2'
import { sha256 } from '@noble/hashes/sha256'
import { hkdf } from '@noble/hashes/hkdf'
import { randomBytes } from '@noble/ciphers/webcrypto'
import { gcm } from '@noble/ciphers/aes'
import { utf8ToBytes, bytesToUtf8 } from '@noble/ciphers/utils'

/**
 * Generates a secure random recovery key.
 * This key is our “master key” that can be used for recovery.
 */
export function generateRecoveryKey(): Uint8Array {
  const key = new Uint8Array(32)
  crypto.getRandomValues(key)
  return key
}

// Generate a new seed phrase (mnemonic)
export function generateSeedPhrase(): string {
  return generateMnemonic(englishWordlist)
}

// Validate an existing seed phrase
export function validateSeedPhrase(mnemonic: string): boolean {
  return validateMnemonic(mnemonic, englishWordlist)
}

// Convert a mnemonic to a cryptographic seed
export function mnemonicToSeed(mnemonic: string, password: string = ''): Uint8Array {
  if (!validateSeedPhrase(mnemonic)) {
    throw new Error('Invalid seed phrase')
  }
  return mnemonicToSeedSync(mnemonic, password)
}

// Generate Ed25519 key pair from seed
export async function generateEd25519Keys(seed: Uint8Array) {
  // Use the first 32 bytes of the seed for Ed25519
  const privateKey = seed.slice(0, 32)

  // Derive the public key
  const publicKey = await getPublicKeyAsync(privateKey)

  return { publicKey, privateKey }
}

export async function signData(data: Uint8Array, privateKey: string) {
  const p = base64UrlToUint8Array(privateKey)
  return uint8ArrayToBase64Url((await signAsync(data, p)).buffer)
}

export async function verifySignature(
  signature: string,
  data: Uint8Array,
  publicKey: string,
): Promise<boolean> {
  const s = base64UrlToUint8Array(signature)
  return await verifyAsync(s, data, base64UrlToUint8Array(publicKey))
}

export async function generateAssymetricRandomNewKey() {
  const mnemonic = generateSeedPhrase()

  return { mnemonic, ...(await base64UrlEd25519Keys(mnemonic)) }
}

export async function base64UrlEd25519Keys(mnemonic: string) {
  const seed = mnemonicToSeed(mnemonic)
  const { publicKey, privateKey } = await generateEd25519Keys(seed)
  console.log('Public Key:', publicKey)
  console.log('Private Key:', privateKey)
  return {
    publicKey: uint8ArrayToBase64Url(publicKey.buffer),
    privateKey: uint8ArrayToBase64Url(privateKey.buffer),
  }
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

// ===== JS-based Implementation (existing) =====

export function unlockWith(masterPassword: string): Uint8Array {
  // Derive a session key using a fixed salt.
  const sessionSalt = 'static-session-salt' // store securely in production
  return pbkdf2(sha256, utf8ToBytes(masterPassword), utf8ToBytes(sessionSalt), {
    c: 100000,
    dkLen: 32,
  })
}

export function deriveKey(sessionKey: Uint8Array, salt: string, id: string): Uint8Array {
  // Derive a per-record key using the session key, salt, and record ID.
  return pbkdf2(sha256, sessionKey, utf8ToBytes(salt + id), { c: 100000, dkLen: 32 })
}

export function encryptObject(obj: unknown, key: Uint8Array): { iv: string; ciphertext: string } {
  const plainText = JSON.stringify(obj)
  const iv = randomBytes(24)
  const aes = gcm(key, iv)
  const ciphertext = aes.encrypt(utf8ToBytes(plainText))
  return {
    iv: uint8ArrayToBase64Url(iv.buffer),
    ciphertext: uint8ArrayToBase64Url(ciphertext.buffer),
  }
}

export function decryptObject(
  { iv, ciphertext }: { iv: string; ciphertext: string },
  key: Uint8Array,
): unknown {
  const aes = gcm(key, base64UrlToUint8Array(iv))
  const decrypted = aes.decrypt(base64UrlToUint8Array(ciphertext))
  return JSON.parse(bytesToUtf8(decrypted))
}

export function urlSafeBase64Uuid() {
  // Generate a UUID
  const hexUuid = uuidv1()

  // Convert the UUID from hex to a Buffer
  const bufferUuid = Buffer.from(hexUuid.replace(/-/g, ''), 'hex')

  // Convert the Buffer to a base64 string
  const base64Uuid = urlSafe64BitString(bufferUuid)

  return base64Uuid
}

export async function sha256UrlSafeHash(obj: unknown) {
  const json = JSON.stringify(obj)
  const encoder = new TextEncoder()
  const data = encoder.encode(json)

  const hashBuffer = await crypto.subtle.digest('SHA-256', data)
  return urlSafe64BitString(Buffer.from(hashBuffer))
} // Generate a new seed phrase (mnemonic)

export function generateSalt(): string {
  return uint8ArrayToBase64Url(randomBytes(16).buffer)
}

// Generate a random key (256 bits) for HKDF
export function generateRandomKey() {
  const keyBytes = randomBytes(32)
  return hkdf(sha256, keyBytes, undefined, undefined, 32) // Derives a 256-bit key
}
