import { pyodideArtifact } from './pyodideArtifact'
import { sandboxArtifacts } from './sandboxArtifacts'

const bytesToBase64 = (bytes: Uint8Array): string => {
  let binary = ''
  for (let offset = 0; offset < bytes.length; offset += 32_768) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 32_768))
  }
  return btoa(binary)
}

const bytesToHex = (bytes: Uint8Array): string =>
  Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')

const sha256 = async (bytes: Uint8Array): Promise<string> => {
  const digestInput = Uint8Array.from(bytes)
  return bytesToHex(new Uint8Array(await crypto.subtle.digest('SHA-256', digestInput)))
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
  const manifestHash = await sha256(
    new TextEncoder().encode(JSON.stringify(Object.entries(resolved.artifact.assets))),
  )
  if (manifestHash !== resolved.artifact.id) {
    throw new Error(`Sandbox artifact manifest integrity check failed: ${resolved.artifact.id}`)
  }

  if (typeof window === 'undefined') {
    const modulePath = './nodeSandboxAssetLoader.ts'
    const { loadNodeSandboxAsset } = await import(/* @vite-ignore */ modulePath)
    return await loadNodeSandboxAsset(
      resolved.artifact.package,
      resolved.fileName,
      resolved.expectedHash,
    )
  }

  const response = await fetch(
    `/assets/sandbox/${resolved.artifact.id}/${encodeURIComponent(resolved.fileName)}`,
  )
  if (!response.ok) throw new Error(`Unable to load sandbox asset: ${resolved.fileName}`)
  const bytes = new Uint8Array(await response.arrayBuffer())
  const actualHash = await sha256(bytes)
  if (actualHash !== resolved.expectedHash) {
    throw new Error(`Sandbox asset integrity check failed: ${resolved.fileName}`)
  }
  return bytes
}

export async function loadSandboxAsset(input: string): Promise<string | null> {
  const bytes = await loadSandboxAssetBytes(input)
  return bytes ? bytesToBase64(bytes) : null
}

export const pyodideArtifactBaseUrl = `taskyon-artifact://${pyodideArtifact.id}/` as const
