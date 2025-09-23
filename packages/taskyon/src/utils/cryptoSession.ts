/**
 * @file useCryptoSession.ts
 * @description Simplified crypto session management with minimal persistence
 */

import {
  keyPairFromMnemonic,
  generateAssymetricKeyDeriver,
  generateWrappedSessionKey,
  unwrapKeySymmetric,
  reWrapSessionKeySymmetric,
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
      ? await reWrapSessionKeySymmetric(options.wrappedSK, options.unwrapper, kek)
      : options.wrappedSK
    : await generateWrappedSessionKey(kek)
  const SK = await unwrapKeySymmetric(wrappedSK, kek)

  // Initialize user key pair (in memory only)
  const UK = options?.mnemonic
    ? await keyPairFromMnemonic(options.mnemonic)
    : (options?.userKeyPair ?? DK)

  const exportSessionKey = async (shareKey?: CryptoKey) => {
    if (shareKey) {
      return await reWrapSessionKeySymmetric(wrappedSK, kek, shareKey)
    } else {
      return wrappedSK
    }
  }

  // for security reasons, we eliminate the "mnemonic" from subsequent, derived sessions.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { mnemonic, ...oldOptions } = options ?? {}
  const derive = (newOptions: CryptoSessionOptions) =>
    createCryptoSession({
      ...oldOptions,
      deviceKeyPair: DK,
      userKeyPair: UK,
      ...newOptions,
    })

  return {
    getSessionKey: () => SK,
    getDevicePublicKey: () => DK.publicKey,
    deviceId: () => cryptoKeyToBase64(DK.publicKey),
    getDeviceKey: () => DK,
    getUserPublicKey: () => UK,
    exportSessionKey,
    getSessionId: () => keyFingerPrint(SK),
    getWrapperId: () => keyFingerPrint(kek),
    derive,
    newSessionKey: (wrappedSK?: string) => derive({ wrappedSK }),
    newDeviceKey: (deviceKeyPair?: CryptoKeyPair) =>
      derive({
        deviceKeyPair,
        unwrapper: kek,
      }),
  }
}

export type CryptoSession = Awaited<ReturnType<typeof createCryptoSession>>
