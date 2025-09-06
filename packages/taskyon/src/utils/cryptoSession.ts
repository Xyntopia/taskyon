/**
 * @file useCryptoSession.ts
 * @description Simplified crypto session management with minimal persistence
 */

import {
  keyPairFromMnemonic,
  generateAssymetricKeyDeriver,
  generateWrappedSessionKey,
  unwrapSessionKey,
  reWrapSessionKey,
  deriveKek,
  cryptoKeyToBase64,
  keyFingerPrint,
} from './crypto'

export type CryptoSessionOptions = {
  wrappedSK?: string | undefined
  unwrapper?: CryptoKey | undefined
  mnemonic?: string | undefined
  userKeyPair?: CryptoKeyPair | undefined
  deviceKeyPair?: CryptoKeyPair | undefined
  bindingKey?: CryptoKey | undefined
}

export async function createCryptoSession(options?: CryptoSessionOptions) {
  // Initialize or load device key pair
  const existingDeviceKey = options?.deviceKeyPair ?? undefined
  let DK: CryptoKeyPair
  if (!existingDeviceKey) {
    DK = await generateAssymetricKeyDeriver()
  } else {
    DK = existingDeviceKey
  }
  const kek = await deriveKek(DK.privateKey, options?.bindingKey ?? DK.publicKey)

  // Initialize session key (in memory only)
  const wrappedSK = options?.wrappedSK
    ? options?.unwrapper
      ? await reWrapSessionKey(options.wrappedSK, options.unwrapper, kek)
      : options.wrappedSK
    : await generateWrappedSessionKey(kek)
  const SK = await unwrapSessionKey(wrappedSK, kek)

  // Initialize user key pair (in memory only)
  const UK = options?.mnemonic
    ? await keyPairFromMnemonic(options.mnemonic)
    : (options?.userKeyPair ?? DK)

  const exportSessionKey = async (shareKey?: CryptoKey) => {
    if (shareKey) {
      return await reWrapSessionKey(wrappedSK, kek, shareKey)
    } else {
      return wrappedSK
    }
  }

  return {
    getSessionKey: () => SK,
    getDevicePublicKey: () => DK.publicKey,
    deviceId: () => cryptoKeyToBase64(DK.publicKey),
    getDeviceKey: () => DK,
    getUserPublicKey: () => UK,
    exportSessionKey,
    getSessionId: () => keyFingerPrint(SK), // <-- added
    derive: (options?: CryptoSessionOptions) =>
      createCryptoSession({ wrappedSK, deviceKeyPair: DK, userKeyPair: UK, ...options }),
    newSessionKey: () => createCryptoSession({ deviceKeyPair: DK, userKeyPair: UK }),
    newDeviceKey: () => createCryptoSession({ wrappedSK, userKeyPair: UK, unwrapper: kek }),
  }
}

export type CryptoSession = Awaited<ReturnType<typeof createCryptoSession>>
