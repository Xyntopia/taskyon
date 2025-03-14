import { generateRecoveryKey } from './crypto_js'
import { base64UrlToUint8Array, uint8ArrayToBase64Url } from './encoding'

/**
 * Registers a device-bound credential.
 * You would normally call this once (or on re‑registration).
 */
export async function registerPasskey(): Promise<PublicKeyCredential> {
  const challenge = crypto.getRandomValues(new Uint8Array(32))
  const publicKey: PublicKeyCredentialCreationOptions = {
    challenge,
    rp: { name: 'Your App' },
    user: {
      id: crypto.getRandomValues(new Uint8Array(16)),
      name: 'user@example.com',
      displayName: 'User',
    },
    pubKeyCredParams: [{ type: 'public-key', alg: -7 }], // ES256
    authenticatorSelection: { userVerification: 'preferred' },
    timeout: 60000,
    attestation: 'none',
  }
  return (await navigator.credentials.create({ publicKey })) as PublicKeyCredential
}

/**
 * Derives a device-bound key by initiating a WebAuthn authentication.
 * The returned key is derived from the signature of a random challenge.
 */
export async function deriveDeviceKey(storedCredentialId: Uint8Array): Promise<CryptoKey> {
  const challenge = crypto.getRandomValues(new Uint8Array(32))
  const publicKey: PublicKeyCredentialRequestOptions = {
    challenge,
    allowCredentials: [
      {
        id: storedCredentialId,
        type: 'public-key',
      },
    ],
    userVerification: 'preferred',
    timeout: 60000,
  }

  const assertion = await navigator.credentials.get({ publicKey })
  if (!assertion) {
    throw new Error('Device authentication failed')
  }
  const authResponse = (assertion as PublicKeyCredential).response as AuthenticatorAssertionResponse
  // Use the signature as raw key material. (Simplified: in practice, apply a proper KDF)
  const signature = new Uint8Array(authResponse.signature)

  // Derive a symmetric key from the signature using a basic import (note: you may want to hash it first)
  return crypto.subtle.importKey('raw', signature, { name: 'AES-GCM' }, false, [
    'encrypt',
    'decrypt',
  ])
}

/**
 * Wrap (encrypt) the session token with the device-bound key.
 */
export async function wrapSessionToken(
  sessionToken: string,
  deviceKey: CryptoKey,
): Promise<string> {
  const enc = new TextEncoder()
  const iv = crypto.getRandomValues(new Uint8Array(12)) // AES-GCM recommended IV length
  const ciphertextBuffer = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    deviceKey,
    enc.encode(sessionToken),
  )
  return JSON.stringify({
    iv: uint8ArrayToBase64Url(iv.buffer),
    ciphertext: uint8ArrayToBase64Url(ciphertextBuffer),
  })
}

/**
 * Unwrap (decrypt) the session token using the device-bound key.
 */
export async function unwrapSessionToken(
  encryptedData: string,
  deviceKey: CryptoKey,
): Promise<string> {
  const { iv, ciphertext } = JSON.parse(encryptedData)
  const ivArray = base64UrlToUint8Array(iv)
  const ctArray = base64UrlToUint8Array(ciphertext)
  const decryptedBuffer = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: ivArray },
    deviceKey,
    ctArray,
  )
  return new TextDecoder().decode(decryptedBuffer)
}

/**
 * Initializes (or retrieves) the session token.
 * If masterPassword is provided, we assume this is a fresh unlock.
 * Otherwise we attempt to retrieve the token from persistent storage.
 */
export async function initializeSession(
  storedCredentialId: Uint8Array,
  masterPassword?: string,
): Promise<CryptoKey> {
  const STORAGE_KEY = 'wrappedSessionToken'

  if (masterPassword) {
    // FIRST-TIME UNLOCK:
    // 1. Generate a recovery (master) key; in practice, you might mix the masterPassword with randomness.
    const recoveryKey = generateRecoveryKey()

    // For demonstration, we use the base64 of recoveryKey as our session token.
    const sessionToken = uint8ArrayToBase64Url(recoveryKey.buffer)

    // 2. Derive the device-bound key via WebAuthn.
    const deviceKey = await deriveDeviceKey(storedCredentialId)
    // 3. Wrap (encrypt) the session token with the device key.
    const wrappedToken = await wrapSessionToken(sessionToken, deviceKey)
    // 4. Persist the wrapped token in browser storage.
    localStorage.setItem(STORAGE_KEY, wrappedToken)
    // 5. Import the session token as a CryptoKey for use in our encryption routines.
    return importSessionKey(sessionToken)
  } else {
    // RETURNING USER:
    const wrappedToken = localStorage.getItem(STORAGE_KEY)
    if (!wrappedToken) {
      throw new Error('No stored session token, please unlock with your master password.')
    }
    // Derive device-bound key again.
    const deviceKey = await deriveDeviceKey(storedCredentialId)
    // Unwrap (decrypt) the session token.
    const sessionToken = await unwrapSessionToken(wrappedToken, deviceKey)
    return importSessionKey(sessionToken)
  }
}

/**
 * Imports a session token (in base64 format) as a CryptoKey,
 * so it can be used with our WebCrypto-based wrappers.
 */
export async function importSessionKey(sessionToken: string): Promise<CryptoKey> {
  const raw = base64UrlToUint8Array(sessionToken)
  return crypto.subtle.importKey('raw', raw, { name: 'AES-GCM' }, false, [
    'deriveKey',
    'encrypt',
    'decrypt',
  ])
}
