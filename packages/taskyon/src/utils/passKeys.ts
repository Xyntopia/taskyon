import { base64UrlToUint8Array, uint8ArrayToBase64Url } from '@taskyon/taskyon'

/**
 * Registers a device-bound credential.
 * You would normally call this once (or on re‑registration).
 */
async function registerPasskey(): Promise<PublicKeyCredential> {
  const challenge = crypto.getRandomValues(new Uint8Array(32))
  const publicKey: PublicKeyCredentialCreationOptions = {
    challenge,
    rp: { name: 'Taskyon' },
    user: {
      id: crypto.getRandomValues(new Uint8Array(16)),
      name: 'local-encryption-key',
      displayName: 'Local Encryption Key',
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
async function deriveDeviceKey(storedCredentialId: Uint8Array): Promise<CryptoKey> {
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

  const assertion = await navigator.credentials.get({ mediation: 'silent', publicKey })
  if (!assertion) {
    throw new Error('Device authentication failed')
  }
  const authResponse = (assertion as PublicKeyCredential).response as AuthenticatorAssertionResponse
  // Use the signature as raw key material. (Simplified: in practice, apply a proper KDF)
  const signature = new Uint8Array(authResponse.signature)
  const keyMaterial = await crypto.subtle.digest('SHA-256', signature)

  // Derive a symmetric key from the signature using a basic import (note: you may want to hash it first)
  return crypto.subtle.importKey('raw', keyMaterial, { name: 'AES-GCM' }, false, [
    'encrypt',
    'decrypt',
  ])
}

/**
 * Wrap (encrypt) the session token with the device-bound key.
 */
async function wrapSessionToken(sessionToken: string, deviceKey: CryptoKey): Promise<string> {
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
async function unwrapSessionToken(encryptedData: string, deviceKey: CryptoKey): Promise<string> {
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
 * Imports a session token (in base64 format) as a CryptoKey,
 * so it can be used with our WebCrypto-based wrappers.
 */
async function importSessionKey(sessionToken: string): Promise<CryptoKey> {
  const raw = base64UrlToUint8Array(sessionToken)
  return crypto.subtle.importKey('raw', raw, { name: 'AES-GCM' }, false, [
    'deriveKey',
    'encrypt',
    'decrypt',
  ])
}

/**
 * Ensures a passkey exists. If not, registers a new one and stores its ID.
 */
async function ensurePasskey(STORAGE_CREDENTIAL_ID: string): Promise<Uint8Array> {
  const storedId = localStorage.getItem(STORAGE_CREDENTIAL_ID)

  if (storedId) {
    return base64UrlToUint8Array(storedId)
  }

  // Register new passkey
  const credential = await registerPasskey()
  const newId = new Uint8Array(credential.rawId)
  localStorage.setItem(STORAGE_CREDENTIAL_ID, uint8ArrayToBase64Url(newId.buffer))

  return newId
}

/**
 * Initializes session, ensuring a passkey exists and deriving a device-bound key.
 */
export async function initializeSessionWithPasskey(
  STORAGE_CREDENTIAL_ID: string,
  STORAGE_SESSION_KEY: string,
): Promise<CryptoKey> {
  const storedCredentialId = await ensurePasskey(STORAGE_CREDENTIAL_ID)

  // First-time unlock: generate a session token if missing
  if (!localStorage.getItem(STORAGE_SESSION_KEY)) {
    const sessionToken = uint8ArrayToBase64Url(crypto.getRandomValues(new Uint8Array(32)).buffer) // Random token
    const deviceKey = await deriveDeviceKey(storedCredentialId)
    localStorage.setItem(STORAGE_SESSION_KEY, await wrapSessionToken(sessionToken, deviceKey))
    return importSessionKey(sessionToken)
  }

  // Returning user: derive key and decrypt session
  const wrappedToken = localStorage.getItem(STORAGE_SESSION_KEY)!
  const deviceKey = await deriveDeviceKey(storedCredentialId)
  const unwrappedKey = await unwrapSessionToken(wrappedToken, deviceKey)
  return importSessionKey(unwrappedKey)
}
