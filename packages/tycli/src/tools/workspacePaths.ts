import { relative, resolve } from 'node:path'
import process from 'node:process'

const normalizeRelativeDirectory = (value: string) => value.replace(/\\/g, '/').replace(/\/+$/, '')

export const resolveWorkspacePath = (filePath: string) => {
  const root = process.cwd()
  const fullPath = resolve(root, filePath)
  const relativePath = relative(root, fullPath)
  if (relativePath.startsWith('..') || relativePath === '' || filePath.startsWith('/')) {
    throw new Error('File path must be a relative path inside the current workspace.')
  }
  return fullPath
}

export const assertPathInsideArtifactRoot = (filePath: string, artifactRoot?: string) => {
  const root = artifactRoot?.trim()
  if (!root) return

  if (root.startsWith('/') || root.includes('..')) {
    throw new Error('artifactRoot must be a relative directory inside the current workspace.')
  }

  const normalizedRoot = normalizeRelativeDirectory(root)
  const normalizedPath = filePath.replace(/\\/g, '/')
  const rootPrefix = `${normalizedRoot}/`
  if (normalizedPath !== normalizedRoot && !normalizedPath.startsWith(rootPrefix)) {
    throw new Error(`File path must be inside artifactRoot ${rootPrefix}.`)
  }
}
