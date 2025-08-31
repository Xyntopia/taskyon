// encrypt.ts

import z from 'zod'
import {
  generateRandomEncryptionKey,
  unwrapWithSymmetricKey,
  wrapKeyWithPublicKey,
  wrapWithAssymetricKey,
  type AskSession,
} from './crypto'
import { base64UrlToUint8Array, uint8ArrayToBase64UrlSafe } from './encoding'

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
