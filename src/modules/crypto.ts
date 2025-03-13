import { generateMnemonic, validateMnemonic, mnemonicToSeedSync } from '@scure/bip39'
import { wordlist as englishWordlist } from '@scure/bip39/wordlists/english'
import { signAsync, getPublicKeyAsync, verifyAsync } from '@noble/ed25519'
import { base64UrlToUint8Array, uint8ArrayToBase64Url, urlSafe64BitString } from './encoding'
import { v1 as uuidv1 } from 'uuid'
import { Buffer } from 'buffer'
import { pbkdf2 } from '@noble/hashes/pbkdf2'
import { sha256 } from '@noble/hashes/sha256'
import { randomBytes } from '@noble/ciphers/webcrypto'
import { gcm } from '@noble/ciphers/aes'
import { utf8ToBytes, bytesToUtf8 } from '@noble/ciphers/utils'

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
  return uint8ArrayToBase64Url(await signAsync(data, p))
}

export async function verifySignature(
  signature: string,
  data: Uint8Array,
  publicKey: string,
): Promise<boolean> {
  const s = base64UrlToUint8Array(signature)
  return await verifyAsync(s, data, base64UrlToUint8Array(publicKey))
}

export async function generateRandomNewKey() {
  const mnemonic = generateSeedPhrase()

  return { mnemonic, ...(await base64UrlEd25519Keys(mnemonic)) }
}

export async function base64UrlEd25519Keys(mnemonic: string) {
  const seed = mnemonicToSeed(mnemonic)
  const { publicKey, privateKey } = await generateEd25519Keys(seed)
  console.log('Public Key:', publicKey)
  console.log('Private Key:', privateKey)
  return {
    publicKey: uint8ArrayToBase64Url(publicKey),
    privateKey: uint8ArrayToBase64Url(privateKey),
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

export function deriveKey(password: string, salt: string, pluginHash: string): Uint8Array {
  return pbkdf2(sha256, utf8ToBytes(password + pluginHash), utf8ToBytes(salt), {
    c: 100000,
    dkLen: 32,
  })
}

export function encryptObject(
  obj: Record<string, unknown>,
  key: Uint8Array,
): { iv: string; ciphertext: string } {
  const plainText = JSON.stringify(obj)
  const iv = randomBytes(24) // Noble uses 24-byte nonce for GCM
  const aes = gcm(key, iv)
  const ciphertext = aes.encrypt(utf8ToBytes(plainText))

  return {
    iv: uint8ArrayToBase64Url(iv),
    ciphertext: uint8ArrayToBase64Url(ciphertext),
  }
}

export function decryptObject(
  { iv, ciphertext }: { iv: string; ciphertext: string },
  key: Uint8Array,
): Record<string, unknown> {
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
}
