import type { Hash } from './caching.ts'
import type { DagNodeStaticDependencyFingerprint } from './dagNodeRecord.ts'

export const SELF_HASH_PLACEHOLDER = '__TASKYON_SELF_HASH__'

export const hashFilePart = (hash: Hash): string => hash.replace(':', '_')

export const hashFromFilePart = (value: string): Hash | null => {
  if (!value.startsWith('sha256_')) return null
  const digest = value.slice('sha256_'.length)
  if (!/^[A-Za-z0-9_-]+$/.test(digest)) return null
  return `sha256:${digest}`
}

const base64UrlFromBytes = (bytes: Uint8Array): string => {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

export const hashCanonicalDagNodeSource = async (source: string): Promise<Hash> => {
  const cryptoImpl = globalThis.crypto
  if (!cryptoImpl?.subtle) {
    throw new Error('crypto.subtle is required to hash immutable DAG nodes')
  }
  const digest = await cryptoImpl.subtle.digest('SHA-256', new TextEncoder().encode(source))
  return `sha256:${base64UrlFromBytes(new Uint8Array(digest))}`
}

export const hashStaticDagNodeSource = async (
  source: string,
  fingerprint: DagNodeStaticDependencyFingerprint,
): Promise<Hash> => {
  // TODO: Replace or augment this Option A dependency fingerprint with a Vite/Rollup
  // bundled emitted-artifact hash so third-party implementation changes are captured directly.
  return await hashCanonicalDagNodeSource(
    JSON.stringify({
      kind: 'taskyon.staticDagNode.v1',
      source,
      fingerprint: {
        importSpecifiers: [...(fingerprint.importSpecifiers ?? [])].sort(),
        lockfileHash: fingerprint.lockfileHash ?? null,
      },
    }),
  )
}
