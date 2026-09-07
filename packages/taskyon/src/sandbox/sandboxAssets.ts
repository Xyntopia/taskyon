import { pyodideArtifact } from './pyodideArtifact'
import { sandboxArtifacts } from './sandboxArtifacts'
import { loadSandboxArtifactBytes } from '@taskyon/common/modules/sandbox/sandboxAssets'

const bytesToBase64 = (bytes: Uint8Array): string => {
  let binary = ''
  for (let offset = 0; offset < bytes.length; offset += 32_768) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 32_768))
  }
  return btoa(binary)
}

const parseSandboxAssetUrl = (input: string) => {
  const url = new URL(input)
  if (url.protocol !== 'taskyon-artifact:') return null
  const artifact = sandboxArtifacts.find(({ id }) => id === url.hostname)
  if (!artifact) throw new Error(`Unknown sandbox artifact: ${url.hostname}`)
  const fileName = decodeURIComponent(url.pathname.slice(1))
  const asset = Object.entries(artifact.assets).find(([name]) => name === fileName)
  if (!asset) throw new Error(`Unknown sandbox artifact asset: ${fileName}`)
  const [, expectedHash] = asset
  return { artifact, expectedHash, fileName }
}

export async function loadSandboxAssetBytes(input: string): Promise<Uint8Array | null> {
  const resolved = parseSandboxAssetUrl(input)
  if (!resolved) return null
  return loadSandboxArtifactBytes(resolved.artifact, resolved.fileName)
}

export async function loadSandboxAsset(input: string): Promise<string | null> {
  const bytes = await loadSandboxAssetBytes(input)
  return bytes ? bytesToBase64(bytes) : null
}

export const pyodideArtifactBaseUrl = `taskyon-artifact://${pyodideArtifact.id}/` as const
