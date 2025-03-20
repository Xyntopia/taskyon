import { urlSafe64BitString } from './encoding'
import { v1 as uuidv1 } from 'uuid'
import { Buffer } from 'buffer'
import * as cryptoweb from './crypto_webcrypto'
import * as cryptojs from './crypto_js'

// crypto.ts

const useWebCrypto = typeof window !== 'undefined' && window.crypto

// this doesn't work yet bcause our current targets don't support top-level await yet!
//const loadCryptoModule = async () =>
//  useWebCrypto ? import('./crypto_webcrypto') : import('./crypto_js')
//const cryptoModulePromise = loadCryptoModule()

export const { encryptObject, decryptObject, deriveKey, generateSalt, sha256UrlSafeHash } =
  useWebCrypto ? cryptoweb : cryptojs

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
