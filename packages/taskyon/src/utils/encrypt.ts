// encrypt.ts

import z from 'zod'
import {
  cryptoKeyToBase64,
  deriveKek,
  generateAssymetricKeyDeriver,
  generateRandomEncryptionKey,
  unwrapWithSymmetricKey,
  wrapWithSymetricKey,
  type AskCryptoKey,
} from './crypto'
import { base64UrlToUint8Array, uint8ArrayToBase64UrlSafe } from './encoding'

const deriveRowKey = async (key: CryptoKey, info: string | number) => {
  // our rowKey comes in as AES-GCM which we can not use as
  //const raw = await crypto.subtle.exportKey('raw', rowKey)
  const raw = await crypto.subtle.exportKey('raw', key)
  const hkdf = await crypto.subtle.importKey('raw', raw, 'HKDF', false, ['deriveKey'])

  return crypto.subtle.deriveKey(
    {
      name: 'HKDF',
      hash: 'SHA-256',
      // we add a static salt here, because our rowKey is bob-specific and random anyways
      // additionally, we use it with info, so we don't really need a salt here, because
      // our key appears random anyways..
      salt: new TextEncoder().encode('111'),
      info: new TextEncoder().encode(String(info)),
    },
    hkdf,
    { name: 'AES-GCM', length: 256 },
    false, // non-extractable derived key
    ['encrypt', 'decrypt'], // or just 'encrypt' if you only encrypt
  )
}

// Define a type for the encrypted data structure
export const EncryptedDataRow = z.object({
  iv: z.string(),
  ciphertext: z.string(),
  wrk: z.string().describe('wrapped row key'),
  // optional recovery
  pk: z.string().optional(),
  wrkr: z.string().optional().describe('wrapped row key recovery'),
})
export type EncryptedDataRow = z.infer<typeof EncryptedDataRow>

export const EncryptedDataRowMixed = z.object({
  iv: z.instanceof(Uint8Array),
  ciphertext: z.instanceof(Uint8Array),
  wrk: z.string().describe('wrapped row key'),
  // optional recovery
  pk: z.string().optional(),
  wrkr: z.string().optional().describe('wrapped row key recovery'),
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
  rowKey: CryptoKey, // AES-GCM with "encrypt"
  data: BufferSource,
  id: string | number,
  base64: boolean = true,
) {
  // Derive AES-GCM key with HKDF: rowKey is unique per object, so no extra salt is needed.
  // Using HKDF binds the key to the row id for separation, instead of relying only on the 12-byte IV.
  // This avoids accidental cross-row decryption and makes the encryption domain explicit.
  const derivedKey = await deriveRowKey(rowKey, id)

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

export async function encryptDataFile(
  data: BufferSource,
  info: string | number,
  publicRecoveryKey: AskCryptoKey | undefined,
  getSessionKey: AskCryptoKey,
): Promise<EncryptedDataRow>

export async function encryptDataFile(
  data: BufferSource,
  info: string | number,
  publicRecoveryKey: AskCryptoKey | undefined,
  getSessionKey: AskCryptoKey,
  base64: true,
): Promise<EncryptedDataRow>

export async function encryptDataFile(
  data: BufferSource,
  info: string | number,
  publicRecoveryKey: AskCryptoKey | undefined,
  getSessionKey: AskCryptoKey,
  base64: false,
): Promise<EncryptedDataRowMixed>

export async function encryptDataFile(
  data: BufferSource,
  info: string | number, // we need the info in order to derive the key with some additional noise
  // this should be a public key that can be used to encrypt the tool key
  publicRecoveryKey: AskCryptoKey | undefined,
  // and this is the session key provider. This is used to encryp the tool key
  // this way we never have to use the private recovery key anywhere. Except if we
  // want to recover the data...
  // The session key is a symmetric key. We usually save this key in the browser
  // in a secure storage.
  getSessionKey: AskCryptoKey,
  base64: boolean = true, // whether to return the data as base64 strings
) {
  const sk = await getSessionKey()
  // Generate a new random tool key for each set operation
  // we need the key to be extractable, so that we can encrypt it !
  const rowKey = await generateRandomEncryptionKey(false, true)
  const wrappedRK = await wrapWithSymetricKey(sk, rowKey)

  const recovery: { wrkr?: string; pk?: string } = {}
  if (publicRecoveryKey) {
    // Encrypt the tool key using the recovery public key
    // derive a random ephemeral X25519 key in order to wrap the key
    // we will throw away the pruvate part of it after encryption.
    const ephemeralX25519 = await generateAssymetricKeyDeriver()

    const kekWrapper = await deriveKek(ephemeralX25519.privateKey, await publicRecoveryKey())
    recovery.wrkr = await wrapWithSymetricKey(kekWrapper, rowKey)
    // we also need tp save the public ephemeral key in order to recover the row-key with the recovery
    // key.
    recovery.pk = await cryptoKeyToBase64(ephemeralX25519.publicKey)
  }

  // Encrypt the data using the tool key
  if (base64) {
    const { iv, ciphertext } = await encryptData(rowKey, data, info, true)
    return {
      iv,
      ciphertext,
      wrk: wrappedRK,
      ...recovery,
    } as EncryptedDataRow
  } else {
    const { iv, ciphertext } = await encryptData(rowKey, data, info, false)
    return {
      iv,
      ciphertext,
      wrk: wrappedRK,
      ...recovery,
    } as EncryptedDataRowMixed
  }
}

// Decrypt data using derived key
export async function decryptData(
  rowKey: CryptoKey,
  iv: string | Uint8Array<ArrayBuffer>,
  ciphertext: string | Uint8Array<ArrayBuffer>,
  id: string | number,
) {
  const ivBytes = typeof iv === 'string' ? base64UrlToUint8Array(iv) : iv
  const ciphertextBytes =
    typeof ciphertext === 'string' ? base64UrlToUint8Array(ciphertext) : ciphertext

  const derivedKey = await deriveRowKey(rowKey, id)
  const decrypted = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: ivBytes },
    derivedKey,
    ciphertextBytes,
  )

  return new Uint8Array(decrypted)
}

export const decryptDataFile = async (
  encData: EncryptedDataRow | EncryptedDataRowMixed,
  // the info is used to derive the key with some additional noise
  // this is usually the record ID or some other identifier which is unique for the record
  // and not encrypted...
  info: string | number,
  getSessionKey: AskCryptoKey,
) => {
  // TODO: optionally unwrap rowkey using recoverykey!

  // Decrypt the tool key using the symmetric session key (this is always a string)
  const rowKey = await unwrapWithSymmetricKey(await getSessionKey(), encData.wrk, true)

  // Decrypt the data using the tool key. The updated `decryptData` function
  // will handle the type detection internally. No `if` block needed here!
  const data = await decryptData(rowKey, encData.iv, encData.ciphertext, info)
  return data
}
