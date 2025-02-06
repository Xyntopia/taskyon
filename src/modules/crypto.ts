import { generateMnemonic, validateMnemonic, mnemonicToSeedSync } from '@scure/bip39'
import { wordlist as englishWordlist } from '@scure/bip39/wordlists/english'
import { signAsync, getPublicKeyAsync, verifyAsync } from '@noble/ed25519'
import { base64UrlToUint8Array, uint8ArrayToBase64Url, urlSafe64BitString } from './encoding'
import { v1 as uuidv1 } from 'uuid'
import { Buffer } from 'buffer'

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

// Encrypt data with a symmetric key
export async function encryptData(data: Uint8Array, key: CryptoKey): Promise<Uint8Array> {
  const iv = crypto.getRandomValues(new Uint8Array(12)) // 96-bit IV for AES-GCM
  const encryptedData = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, data)
  return new Uint8Array([...iv, ...new Uint8Array(encryptedData)])
}

// Decrypt data with a symmetric key
export async function decryptData(encrypted: Uint8Array, key: CryptoKey): Promise<Uint8Array> {
  const iv = encrypted.slice(0, 12) // Extract the IV (first 12 bytes)
  const ciphertext = encrypted.slice(12) // The rest is the ciphertext
  const decryptedData = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ciphertext)
  return new Uint8Array(decryptedData)
}

// Generate a symmetric key for AES-GCM
export async function generateSymmetricKey(): Promise<CryptoKey> {
  return await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, [
    'encrypt',
    'decrypt',
  ])
}

// Encrypt an object and serialize it as a string
export async function encryptObject(obj: Record<string, unknown>, key: CryptoKey): Promise<string> {
  const serializedData = new TextEncoder().encode(JSON.stringify(obj))
  const encryptedData = await encryptData(serializedData, key)
  return uint8ArrayToBase64Url(encryptedData)
}

// Decrypt an encrypted string back into an object
export async function decryptObject(
  encryptedString: string,
  key: CryptoKey,
): Promise<Record<string, unknown>> {
  const encryptedData = base64UrlToUint8Array(encryptedString)
  const decryptedData = await decryptData(encryptedData, key)
  const jsonString = new TextDecoder().decode(decryptedData)
  return JSON.parse(jsonString) as Record<string, unknown>
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
