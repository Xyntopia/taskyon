export type SandboxArtifact = {
  id: string
  package: string
  assets: Readonly<Record<string, string>>
}

const sha256 = async (bytes: Uint8Array) =>
  Array.from(
    new Uint8Array(await crypto.subtle.digest('SHA-256', Uint8Array.from(bytes))),
    (byte) => byte.toString(16).padStart(2, '0'),
  ).join('')

/** Load only a declared package asset and verify both its manifest and bytes. */
export const loadSandboxArtifactBytes = async (artifact: SandboxArtifact, fileName: string) => {
  const expectedHash = artifact.assets[fileName]
  if (!expectedHash) throw new Error(`Unknown sandbox artifact asset: ${fileName}`)
  const manifestHash = await sha256(
    new TextEncoder().encode(JSON.stringify(Object.entries(artifact.assets))),
  )
  if (manifestHash !== artifact.id)
    throw new Error('Sandbox artifact manifest integrity check failed.')
  if (typeof process !== 'undefined' && process.versions?.node) {
    const modulePath = '@taskyon/common/modules/sandbox/nodeSandboxAssetLoader'
    const { loadNodeSandboxAsset } = await import(/* @vite-ignore */ modulePath)
    return loadNodeSandboxAsset(artifact.package, fileName, expectedHash)
  }
  const response = await fetch(`/assets/sandbox/${artifact.id}/${encodeURIComponent(fileName)}`)
  if (!response.ok) throw new Error(`Unable to load sandbox asset: ${fileName}`)
  const bytes = new Uint8Array(await response.arrayBuffer())
  if ((await sha256(bytes)) !== expectedHash)
    throw new Error(`Sandbox asset integrity check failed: ${fileName}`)
  return bytes
}
