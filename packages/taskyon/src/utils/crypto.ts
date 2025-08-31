import { getPublicKeyAsync } from '@noble/ed25519'
import { generateMnemonic, mnemonicToSeedSync, validateMnemonic } from '@scure/bip39'
import { wordlist as englishWordlist } from '@scure/bip39/wordlists/english'
import {
  base64UrlToUint8Array,
  uint8ArrayToBase64UrlSafe,
  urlSafe64BitString,
} from '@taskyon/taskyon'
import { Buffer } from 'buffer'
import { v1 as uuidv1 } from 'uuid'
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

// used for encryption/decryption
const generateRandomEncryptionKey = () =>
  crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'])

export const wrapSessionKey = async (sk: CryptoKey, kek: CryptoKey) => {
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const wrapped = await crypto.subtle.wrapKey(
    'raw', // format of sessionKey
    sk, // non-extractable key
    kek, //wrapper, //kek, // wrapping key
    { name: 'AES-KW', iv, length: 256 },
  )
  return uint8ArrayToBase64UrlSafe(wrapped)
}

export const unwrapSessionKey = async (wrappedData: string, unwrappingKey: CryptoKey) =>
  crypto.subtle.unwrapKey(
    'raw',
    base64UrlToUint8Array(wrappedData),
    unwrappingKey,
    'AES-KW', // algorithm identifier for key encryption key
    'AES-KW', // algorithm identifier for key to unwrap
    false, // non-extractable
    ['wrapKey', 'unwrapKey'],
  )

// !!!IMPORTANT!!!!
// because we want to export this key it only exports wrapped keys!!
// do not ever export the unwrapped key from this function!!!
export const reWrapSessionKey = async (
  wrappedKeString: string,
  unwrappingKey: CryptoKey,
  newWrappingKey: CryptoKey,
) => {
  const wrappedData = base64UrlToUint8Array(wrappedKeString)
  const sk = await crypto.subtle.unwrapKey(
    'raw',
    wrappedData,
    unwrappingKey,
    'AES-KW', // algorithm identifier for key encryption key
    'AES-KW', // algorithm identifier for key to unwrap
    true, // extractable but only very short lived!!!
    ['wrapKey', 'unwrapKey'],
  )
  return await wrapSessionKey(sk, newWrappingKey)
}

// !!!IMPORTANT!!!!
// because we want to export this key it only exports wrapped keys!!
// do not ever export the unwrapped key from this function!!!
export const generateWrappedSessionKey = async (kek: CryptoKey) => {
  //const wrapper = await generateSessionKey()
  const sk = await crypto.subtle.generateKey(
    { name: 'AES-KW', length: 256 },
    // we only set the key as extractyble here, because we wrap the session key *immediatly* after
    // creating it and then forget about it...
    true,
    ['wrapKey', 'unwrapKey'],
  )

  const wrapped = await wrapSessionKey(sk, kek)
  return wrapped
}

export async function generateAssymetricRandomNewKey() {
  const keyPair = await crypto.subtle.generateKey(
    { name: 'Ed25519' },
    false, // extractable for memory management
    ['sign', 'verify'],
  )
  return keyPair
}

export const generateAssymetricKeyDeriver = async () => {
  const keyPair = (await crypto.subtle.generateKey(
    { name: 'X25519' }, // Use X25519 for key generation
    false, // non-extractable private key
    ['deriveKey', 'deriveBits'],
  )) as unknown as CryptoKeyPair
  return keyPair
}

export const deriveKek = async (
  privateKey: CryptoKey,
  publicKey: CryptoKey,
): Promise<CryptoKey> => {
  return crypto.subtle.deriveKey(
    { name: 'X25519', public: publicKey },
    privateKey,
    { name: 'AES-KW', length: 256 },
    false,
    ['wrapKey', 'unwrapKey'],
  )
}

// Define a type for the encrypted data structure
export const EncryptedDataRow = z.object({
  iv: z.string(),
  ciphertext: z.string(),
  encryptedToolKey: z.string(),
  recoveryEncryptedToolKey: z.string(),
})
export type EncryptedDataRow = z.infer<typeof EncryptedDataRow>

export const EncryptedDataRowMixed = z.object({
  iv: z.instanceof(Uint8Array),
  ciphertext: z.instanceof(Uint8Array),
  encryptedToolKey: z.string(),
  recoveryEncryptedToolKey: z.string(),
})
export type EncryptedDataRowMixed = z.infer<typeof EncryptedDataRowMixed>

async function encryptData<T>(
  rowKey: CryptoKey,
  data: T,
  id: string | number,
): Promise<{ iv: string; ciphertext: string }>

async function encryptData<T>(
  rowKey: CryptoKey,
  data: T,
  id: string | number,
  base64: true,
): Promise<{ iv: string; ciphertext: string }>

async function encryptData<T>(
  rowKey: CryptoKey,
  data: T,
  id: string | number,
  base64: false,
): Promise<{ iv: Uint8Array; ciphertext: Uint8Array }>

// Encrypt object with key derived from rowKey + salt + id
async function encryptData(
  rowKey: CryptoKey,
  data: BufferSource,
  id: string | number,
  base64: boolean = true,
) {
  // Derive AES-GCM key using HKDF
  // we never share the derivedKey and rowKey is unique per encrypted object anyways
  // so it effectivly acts as a salt ... this why we don't need a salt
  // we don't want to use rowKey directly, because the iv would include only 12 bytes
  // and the aad doesn't guarantee non-encrptability without the info
  const derivedKey = await crypto.subtle.deriveKey(
    {
      name: 'HKDF',
      hash: 'SHA-256',
      info: new TextEncoder().encode(String(id)),
    },
    rowKey, // non-extractable
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
      iv: uint8ArrayToBase64UrlSafe(iv.buffer),
      ciphertext: uint8ArrayToBase64UrlSafe(encrypted.buffer),
    }
  else
    return {
      iv: iv,
      ciphertext: encrypted,
    } as { iv: Uint8Array; ciphertext: Uint8Array }
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
  const rowKey = await generateRandomEncryptionKey()

  // Encrypt the tool key using the recovery public key
  const recoveryEncryptedToolKey = await wrapKeyWithPublicKey(await publicRecoveryKey(), rowKey)

  const sessionKey = await getSessionKey() // Encrypt the tool key using the symmetric session key
  const encryptedToolKey = await wrapWithAssymetricKey(sessionKey, rowKey)

  // Encrypt the data using the tool key
  if (base64) {
    const { iv, ciphertext } = await encryptData(rowKey, data, info, base64)
    return {
      iv,
      ciphertext,
      encryptedToolKey,
      recoveryEncryptedToolKey,
    } as EncryptedDataRow
  } else {
    const { iv, ciphertext } = await encryptData(rowKey, data, info, base64)
    return {
      iv,
      ciphertext,
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
  const rowKey = await unwrapWithSymmetricKey(await getSessionKey(), encData.encryptedToolKey)

  // Decrypt the data using the tool key. The updated `decryptData` function
  // will handle the type detection internally. No `if` block needed here!
  const data = await decryptData(rowKey, encData.iv, encData.ciphertext, info)
  return data
}

async function wrapKeyWithPublicKey(publicKey: CryptoKey, dataKey: CryptoKey): Promise<string> {
  const rawKey = await crypto.subtle.exportKey('raw', dataKey)
  const encrypted = await crypto.subtle.encrypt({ name: 'RSA-OAEP' }, publicKey, rawKey)
  return uint8ArrayToBase64UrlSafe(encrypted)
}

async function wrapWithAssymetricKey(
  sessionKey: CryptoKey,
  encryptionKey: CryptoKey,
): Promise<string> {
  const wrappedDekBuffer = await crypto.subtle.wrapKey(
    'raw', // Format of the key to wrap
    encryptionKey, // The key we are protecting
    sessionKey, // The key used to perform the wrapping
    { name: 'AES-KW' }, // The wrapping algorithm
  )
  const wrappedDekB64 = uint8ArrayToBase64UrlSafe(wrappedDekBuffer)
  return wrappedDekB64
}

async function unwrapWithSymmetricKey(sessionKey: CryptoKey, wrappedKeyB64: string) {
  const wrappedKeyBuffer = base64UrlToUint8Array(wrappedKeyB64)

  // Note: Here you tell unwrapKey what kind of key you EXPECT to get back.
  // I've used your example of an HKDF key.
  return crypto.subtle.unwrapKey(
    'raw', // The format of the wrapped key
    wrappedKeyBuffer,
    sessionKey,
    { name: 'AES-KW' },
    {
      // Algorithm for the unwrapped key
      name: 'AES-GCM', // Matches original key type
      length: 256, // Key length (bits)
    },
    false, // is the unwrapped key extractable?
    ['deriveKey'], // Usages for the unwrapped key
  )
}

export async function cryptoKeyToBase64(publicKey: CryptoKey): Promise<string> {
  const exported = await crypto.subtle.exportKey('raw', publicKey)

  // exported is ArrayBuffer (except JWK, but we don’t use it here)
  const bytes = new Uint8Array(exported)

  return uint8ArrayToBase64UrlSafe(bytes.buffer) // your helper
}

// Decrypt data using derived key
export async function decryptData(
  rowKey: CryptoKey,
  iv: string | Uint8Array,
  ciphertext: string | Uint8Array,
  id: string | number,
) {
  // --- START OF CHANGES ---
  // Use `typeof` to check if the inputs are strings. If so, decode them.
  // If they are already ArrayBuffers, use them as is.
  const ivBytes = typeof iv === 'string' ? base64UrlToUint8Array(iv) : iv
  const ciphertextBytes =
    typeof ciphertext === 'string' ? base64UrlToUint8Array(ciphertext) : ciphertext
  // --- END OF CHANGES ---

  const info = new TextEncoder().encode(String(id))

  const derivedKey = await crypto.subtle.deriveKey(
    {
      name: 'HKDF',
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

export function randomString(
  len = 32,
  chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789',
) {
  const charLen = chars.length
  return [...crypto.getRandomValues(new Uint32Array(len))].map((n) => chars[n % charLen]).join('')
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

function encodeEd25519Pkcs8(privateKey: Uint8Array): ArrayBuffer {
  // PKCS#8 header for Ed25519 (RFC8410)
  const pkcs8Header = Uint8Array.from([
    0x30,
    0x2e, // SEQUENCE, length 46
    0x02,
    0x01,
    0x00, // version
    0x30,
    0x05, // AlgorithmIdentifier
    0x06,
    0x03,
    0x2b,
    0x65,
    0x70, // OID 1.3.101.112 (Ed25519)
    0x04,
    0x22, // OCTET STRING, length 34
    0x04,
    0x20, // OCTET STRING, length 32
  ])
  const out = new Uint8Array(pkcs8Header.length + privateKey.length)
  out.set(pkcs8Header, 0)
  out.set(privateKey, pkcs8Header.length)
  return out.buffer
}

const deriveKey32 = async (seed64: Uint8Array, info: string = '') =>
  new Uint8Array(
    await crypto.subtle.deriveBits(
      {
        name: 'HKDF',
        salt: new Uint8Array([]), // optional, can be empty
        info: new TextEncoder().encode(info),
        hash: 'SHA-256',
      },
      await crypto.subtle.importKey('raw', seed64, 'HKDF', false, ['deriveBits']),
      32 * 8, // 32 bytes
    ),
  )

async function generateKeyPairsFromSeed(seed: Uint8Array, extractablePublic = true) {
  if (seed.length <= 32) throw new Error('Seed must be at least 32 bytes')

  const keySeed = await deriveKey32(seed)
  const publicRaw = await getPublicKeyAsync(keySeed)

  // Build PKCS#8 from raw private key
  const pkcs8 = encodeEd25519Pkcs8(keySeed)

  const privateKey = await crypto.subtle.importKey(
    'pkcs8',
    pkcs8,
    { name: 'Ed25519' },
    false, // non-extractable
    ['sign'],
  )

  const publicKey = await crypto.subtle.importKey(
    'raw',
    publicRaw,
    { name: 'Ed25519' },
    extractablePublic,
    ['verify'],
  )

  const pkb64 = uint8ArrayToBase64UrlSafe(publicRaw.buffer)

  return { privateKey, publicKey, pkb64 }
}

export const signData = (data: Uint8Array, privateKey: CryptoKey) =>
  crypto.subtle.sign('Ed25519', privateKey, data)

export const verifySignature = (
  signature: Uint8Array,
  data: Uint8Array,
  publicKey: CryptoKeyPair['publicKey'],
) => crypto.subtle.verify('Ed25519', publicKey, signature, data)

export async function keyPairFromMnemonic(mnemonic: string) {
  const seed = mnemonicToSeed(mnemonic)
  const keyPair = await generateKeyPairsFromSeed(seed)
  return keyPair
}

export function urlSafeBase64Uuid() {
  // Generate a UUID
  const hexUuid = uuidv1()

  // Convert the UUID from hex to a Buffer
  const bufferUuid = Buffer.from(hexUuid.replace(/-/g, ''), 'hex')

  // Convert the Buffer to anode  base64 string
  const base64Uuid = urlSafe64BitString(bufferUuid)

  return base64Uuid
}

// this is sort of a "symmetric wrapping without sending the key"
// two poeple can both use public + private key to derive a new ke each for themselves
// so basically to poeple derive the same key, but with two different methods that is
// each only known to themselves and not ther other person.
export async function wrapKeyWithECDH(
  senderPrivateKey: CryptoKey,
  recipientPublicKey: CryptoKey,
  dataKeyToWrap: CryptoKey,
) {
  // 1. Derive the shared secret, which will be used as a wrapping key.
  //    We are deriving an AES-KW key, which is a standard for key wrapping.
  const sharedWrappingKey = await crypto.subtle.deriveKey(
    {
      name: 'ECDH',
      public: recipientPublicKey, // The recipient's public key
    },
    senderPrivateKey, // The sender's private key
    {
      name: 'AES-KW', // Algorithm for the derived key
      length: 256, // Key length in bits
    },
    true, // The key is extractable (this is not strictly necessary for wrapping)
    ['wrapKey', 'unwrapKey'], // The derived key can be used for wrapping and unwrapping
  )

  // 2. Use the derived shared key to wrap the data key.
  const wrappedKeyBuffer = await crypto.subtle.wrapKey(
    'raw', // The format of the key to wrap
    dataKeyToWrap,
    sharedWrappingKey,
    {
      name: 'AES-KW', // The wrapping algorithm
    },
  )

  // 3. Return the wrapped key as a Base64URL string.
  return uint8ArrayToBase64UrlSafe(wrappedKeyBuffer)
}
