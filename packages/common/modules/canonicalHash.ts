import { sha256 } from '@noble/hashes/sha2.js'
import { bytesToHex } from '@noble/hashes/utils.js'

export type Sha256Hash = `sha256:${string}`

const stableValue = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(stableValue)
  if (!value || typeof value !== 'object') return value

  return Object.fromEntries(
    Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => [key, stableValue(entry)]),
  )
}

export const canonicalJson = (value: unknown): string => {
  const json = JSON.stringify(stableValue(value))
  if (json === undefined) throw new Error('Canonical hashing requires a JSON-serializable value.')
  return json
}

export const canonicalHash = (value: unknown): Sha256Hash =>
  `sha256:${bytesToHex(sha256(new TextEncoder().encode(canonicalJson(value))))}`

export const sha256HashBytes = (value: Uint8Array): Sha256Hash =>
  `sha256:${bytesToHex(sha256(value))}`

export const createSha256Hasher = () => {
  const hash = sha256.create()
  let result: Uint8Array | undefined
  const finish = () => {
    result ??= hash.digest()
    return result
  }
  return {
    update: (value: Uint8Array) => {
      if (result) throw new Error('Cannot update a finalized SHA-256 hash.')
      hash.update(value)
    },
    digestBytes: () => new Uint8Array(finish()),
    digest: (): Sha256Hash => `sha256:${bytesToHex(finish())}`,
  }
}
