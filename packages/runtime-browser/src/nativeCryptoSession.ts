import { z } from 'zod'
import {
  base64UrlToUint8Array,
  cryptoKeyToBase64,
  keyFingerPrint,
  keyPairFromMnemonic,
  uint8ArrayToBase64UrlSafe,
} from '@taskyon/taskyon/runtime-core'
import type { CryptoSession, CryptoSessionOptions } from '@taskyon/taskyon/runtime-core'

/** Capability supplied by the native host, already bound to one namespace. */
export type NativeDeviceCommands = {
  open(bindingPublicKey?: string): Promise<ReturnType<typeof parseNativeDeviceOpen>>
  openSession(
    handle: string,
    transportPublicKey: string,
    wrappedSessionKey?: string,
  ): Promise<NativeSessionEnvelope>
  importSession(
    handle: string,
    transportPublicKey: string,
    transportEnvelope: string,
  ): Promise<NativeSessionEnvelope>
  close(handle: string): Promise<void>
}
export const parseNativeDeviceOpen = (value: unknown) =>
  z
    .object({
      handle: z.string().length(43),
      devicePublicKey: z.string().length(43),
      wrapperId: z.string().length(43),
    })
    .strict()
    .parse(value)
export const parseNativeSessionEnvelope = (value: unknown) =>
  z
    .object({
      wrappedSessionKey: z.string().regex(/^native:v1:[A-Za-z0-9_-]{80}$/),
      transportEnvelope: z.string().regex(/^native:v1:[A-Za-z0-9_-]{80}$/),
    })
    .strict()
    .parse(value)
type NativeSessionEnvelope = ReturnType<typeof parseNativeSessionEnvelope>

const transportAad = (
  wrapper: string,
  handle: string,
  publicKey: string,
  direction: 'in' | 'out',
) =>
  new TextEncoder().encode(
    JSON.stringify(['taskyon.transport.v1', wrapper, handle, publicKey, direction]),
  )

export const nativeEnvelopeParameters = (
  envelope: string,
  additionalData: Uint8Array<ArrayBuffer>,
) => {
  if (!envelope.startsWith('native:v1:')) throw new Error('InvalidEnvelope')
  const bytes = base64UrlToUint8Array(envelope.slice('native:v1:'.length))
  if (bytes.length !== 60) throw new Error('InvalidEnvelope')
  return {
    algorithm: { name: 'AES-GCM', iv: bytes.slice(0, 12), additionalData },
    ciphertext: bytes.slice(12),
  }
}

const createNativeTransport = async (opened: ReturnType<typeof parseNativeDeviceOpen>) => {
  const devicePublicKey = await crypto.subtle.importKey(
    'raw',
    base64UrlToUint8Array(opened.devicePublicKey),
    'X25519',
    true,
    [],
  )
  const ephemeral = await crypto.subtle.generateKey({ name: 'X25519' }, false, ['deriveBits'])
  if (!('privateKey' in ephemeral)) throw new Error('X25519 key generation did not return a pair')
  const publicKey = await cryptoKeyToBase64(ephemeral.publicKey)
  const shared = await crypto.subtle.deriveBits(
    { name: 'X25519', public: devicePublicKey },
    ephemeral.privateKey,
    256,
  )
  const inputKey = await crypto.subtle.importKey('raw', shared, 'HKDF', false, ['deriveKey'])
  new Uint8Array(shared).fill(0)
  const key = (direction: 'in' | 'out') =>
    crypto.subtle.deriveKey(
      {
        name: 'HKDF',
        hash: 'SHA-256',
        salt: new TextEncoder().encode(opened.wrapperId),
        info: transportAad(opened.wrapperId, opened.handle, publicKey, direction),
      },
      inputKey,
      { name: 'AES-GCM', length: 256 },
      false,
      ['wrapKey', 'unwrapKey'],
    )
  return {
    devicePublicKey,
    publicKey,
    outKey: await key('out'),
    inKey: await key('in'),
    outAad: transportAad(opened.wrapperId, opened.handle, publicKey, 'out'),
    inAad: transportAad(opened.wrapperId, opened.handle, publicKey, 'in'),
  }
}

const importSharedSession = async (
  commands: NativeDeviceCommands,
  handle: string,
  transport: Awaited<ReturnType<typeof createNativeTransport>>,
  wrappedSK: string,
  unwrapper: CryptoKey,
) => {
  const key = await crypto.subtle.unwrapKey(
    'raw',
    base64UrlToUint8Array(wrappedSK),
    unwrapper,
    'AES-KW',
    'AES-KW',
    true,
    ['wrapKey', 'unwrapKey'],
  )
  const nonce = crypto.getRandomValues(new Uint8Array(12))
  const ciphertext = await crypto.subtle.wrapKey('raw', key, transport.inKey, {
    name: 'AES-GCM',
    iv: nonce,
    additionalData: transport.inAad,
  })
  const bytes = new Uint8Array(60)
  bytes.set(nonce)
  bytes.set(new Uint8Array(ciphertext), 12)
  return commands.importSession(
    handle,
    transport.publicKey,
    `native:v1:${uint8ArrayToBase64UrlSafe(bytes)}`,
  )
}

const unwrapNativeSession = (
  envelope: string,
  key: CryptoKey,
  aad: Uint8Array<ArrayBuffer>,
  extractable: boolean,
) => {
  const { algorithm, ciphertext } = nativeEnvelopeParameters(envelope, aad)
  return crypto.subtle.unwrapKey('raw', ciphertext, key, algorithm, 'AES-KW', extractable, [
    'wrapKey',
    'unwrapKey',
  ])
}

/** Coordinates one caller-owned native handle and its WebCrypto session capability. */
export const createNativeCryptoSession = async (
  commands: NativeDeviceCommands,
  options: CryptoSessionOptions = {},
): Promise<CryptoSession> => {
  if (options.deviceKeyPair) throw new Error('Native device keys cannot be supplied by JavaScript')
  const bindingPublicKey = options.bindingKey
    ? await cryptoKeyToBase64(options.bindingKey)
    : undefined
  const opened = await commands.open(bindingPublicKey)
  let closing: Promise<void> | undefined
  const close = () => (closing ??= commands.close(opened.handle))
  try {
    const transport = await createNativeTransport(opened)
    const envelope =
      options.wrappedSK && options.unwrapper
        ? await importSharedSession(
            commands,
            opened.handle,
            transport,
            options.wrappedSK,
            options.unwrapper,
          )
        : await commands.openSession(opened.handle, transport.publicKey, options.wrappedSK)
    const sessionKey = await unwrapNativeSession(
      envelope.transportEnvelope,
      transport.outKey,
      transport.outAad,
      false,
    )
    const userKeyPair = options.mnemonic
      ? await keyPairFromMnemonic(options.mnemonic)
      : options.userKeyPair
    const inherited = {
      bindingKey: options.bindingKey,
      userKeyPair,
      wrappedSK: options.wrappedSK,
      unwrapper: options.unwrapper,
    }
    const derive = (next: CryptoSessionOptions) => {
      if (closing) return Promise.reject(new Error('Closed'))
      return createNativeCryptoSession(commands, { ...inherited, ...next })
    }
    return {
      getSessionKey: () => sessionKey,
      getDevicePublicKey: () => transport.devicePublicKey,
      getUserPublicKey: () => userKeyPair?.publicKey ?? transport.devicePublicKey,
      deviceId: () => cryptoKeyToBase64(transport.devicePublicKey),
      getSessionId: () => keyFingerPrint(sessionKey),
      getWrapperId: () => Promise.resolve(opened.wrapperId),
      exportSessionKey: async (shareKey) => {
        if (closing) throw new Error('Closed')
        if (!shareKey) return envelope.wrappedSessionKey
        // Only the session key is temporarily extractable for the existing sharing contract.
        const shareable = await unwrapNativeSession(
          envelope.transportEnvelope,
          transport.outKey,
          transport.outAad,
          true,
        )
        return uint8ArrayToBase64UrlSafe(
          await crypto.subtle.wrapKey('raw', shareable, shareKey, 'AES-KW'),
        )
      },
      derive,
      newSessionKey: (wrappedSK) => derive({ wrappedSK }),
      close,
    }
  } catch (error) {
    await close()
    throw error
  }
}

/** Preserve typed native failures without forwarding platform error messages or identifiers. */
export const nativeDeviceError = (error: unknown) => {
  const value = error instanceof Error ? error.message : error
  return (
    z
      .enum([
        'Locked',
        'Unavailable',
        'MissingDeviceKey',
        'CorruptDeviceKey',
        'InvalidEnvelope',
        'Unauthorized',
        'Closed',
      ])
      .safeParse(value).data ?? 'Unavailable'
  )
}
