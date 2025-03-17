import { urlSafe64BitString } from './encoding'
import { v1 as uuidv1 } from 'uuid'
import { Buffer } from 'buffer'

// crypto.ts

let cryptoModule

const useWebCrypto = typeof window !== 'undefined' && window.crypto

if (useWebCrypto) {
  // We are in a browser environment with WebCrypto support
  cryptoModule = await import('./crypto_webcrypto')
} else {
  // Fallback to custom implementation
  cryptoModule = await import('./crypto_js')
}

export const { encryptObject, decryptObject, deriveKey, generateSalt, sha256UrlSafeHash } =
  cryptoModule

// Add more exports as needed

export function urlSafeBase64Uuid() {
  // Generate a UUID
  const hexUuid = uuidv1()

  // Convert the UUID from hex to a Buffer
  const bufferUuid = Buffer.from(hexUuid.replace(/-/g, ''), 'hex')

  // Convert the Buffer to a base64 string
  const base64Uuid = urlSafe64BitString(bufferUuid)

  return base64Uuid
}
