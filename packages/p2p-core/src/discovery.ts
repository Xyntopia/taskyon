export type DiscoverySecretInput = string | Uint8Array

export type DeriveDiscoveryTokenOptions = {
  namespace?: string
}

function toBytes(input: DiscoverySecretInput): Uint8Array {
  return typeof input === 'string' ? new TextEncoder().encode(input) : input
}

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
}

export async function deriveDiscoveryToken(
  secret: DiscoverySecretInput,
  opts: DeriveDiscoveryTokenOptions = {},
): Promise<string> {
  const namespace = opts.namespace ?? 'taskyon-subnetwork-discovery-v1'
  const secretBytes = toBytes(secret)
  const namespaced = new Uint8Array(secretBytes.length + namespace.length + 1)
  namespaced.set(new TextEncoder().encode(`${namespace}:`), 0)
  namespaced.set(secretBytes, namespace.length + 1)
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', namespaced))
  return `tydisc:${toHex(digest)}`
}

export async function deriveDiscoveryTokens(
  secrets: DiscoverySecretInput[],
  opts: DeriveDiscoveryTokenOptions = {},
): Promise<string[]> {
  const tokens = await Promise.all(secrets.map((secret) => deriveDiscoveryToken(secret, opts)))
  return [...new Set(tokens)].sort()
}

export async function deriveSubnetworkMessageTopic(secret: DiscoverySecretInput): Promise<string> {
  const token = await deriveDiscoveryToken(secret, {
    namespace: 'taskyon-subnetwork-topic-v1',
  })
  return token.replace(/^tydisc:/, 'tynet:')
}
