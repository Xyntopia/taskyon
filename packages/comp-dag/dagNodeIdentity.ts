import type { Hash } from './caching.ts'

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
