import type { TaskyonStorageClient } from '../api/storageProtocol'
import {
  workspaceGlobMatches,
  type WorkspaceEntry,
  type WorkspaceMatch,
  type WorkspaceOperations,
} from './workspaceTools'

type StoredWorkspaceFile = {
  version: 1
  content: string
}

const normalizePath = (value: string, allowRoot = false) => {
  const path = value
    .trim()
    .replace(/\\/g, '/')
    .replace(/^\.\//, '')
    .replace(/\/{2,}/g, '/')
  const parts = path.split('/').filter(Boolean)
  if (path.startsWith('/') || parts.some((part) => part === '.' || part === '..')) {
    throw new Error(`Workspace path escapes its root: ${value}`)
  }
  if (!parts.length) {
    if (allowRoot) return ''
    throw new Error('Workspace file path must not be empty.')
  }
  return parts.join('/')
}

const parseStoredFile = (value: unknown, path: string): StoredWorkspaceFile => {
  if (
    typeof value !== 'object' ||
    value === null ||
    Array.isArray(value) ||
    (value as { version?: unknown }).version !== 1 ||
    typeof (value as { content?: unknown }).content !== 'string'
  ) {
    throw new Error(`Invalid virtual workspace record for "${path}".`)
  }
  return value as StoredWorkspaceFile
}

const escapeRegex = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

const pathInScope = (path: string, scope: string) =>
  !scope || path === scope || path.startsWith(`${scope}/`)

export const createStorageWorkspaceOperations = (
  storageClient: TaskyonStorageClient,
  namespace: string,
): WorkspaceOperations => {
  const listFilePaths = async () => {
    const result = await storageClient.listIds({ namespace })
    if (result.ids.length > 5_000) {
      throw new Error('Virtual workspace search is limited to 5000 files.')
    }
    return result.ids
      .filter((id): id is string => typeof id === 'string')
      .map((id) => normalizePath(id))
  }

  return {
    read: async (rawPath) => {
      const path = normalizePath(rawPath)
      const result = await storageClient.get({ namespace, id: path })
      if (result.value === null) throw new Error(`Workspace file not found: ${path}`)
      return { content: parseStoredFile(result.value, path).content, revision: result.contentHash }
    },
    write: async ({ path: rawPath, content, expectedRevision }) => {
      const path = normalizePath(rawPath)
      const value: StoredWorkspaceFile = { version: 1, content }
      if (expectedRevision === undefined) {
        await storageClient.set({ namespace, id: path, value })
        return { revision: (await storageClient.get({ namespace, id: path })).contentHash }
      }
      const result = await storageClient.setIfUnchanged({
        namespace,
        id: path,
        expectedContentHash: expectedRevision,
        value,
      })
      if (!result.written) throw new Error(`Workspace file changed while editing: ${path}`)
      return { revision: result.currentContentHash }
    },
    find: async ({ pattern, path: rawScope, limit }) => {
      const scope = normalizePath(rawScope ?? '', true)
      return (await listFilePaths())
        .filter((path) => pathInScope(path, scope))
        .filter((path) => {
          const relativePath = scope ? path.slice(scope.length + 1) : path
          return workspaceGlobMatches(pattern, relativePath) || workspaceGlobMatches(pattern, path)
        })
        .slice(0, limit)
    },
    list: async ({ path: rawScope, limit }) => {
      const scope = normalizePath(rawScope ?? '', true)
      const entries = new Map<string, WorkspaceEntry['type']>()
      for (const filePath of await listFilePaths()) {
        if (!pathInScope(filePath, scope) || filePath === scope) continue
        const remainder = scope ? filePath.slice(scope.length + 1) : filePath
        const first = remainder.split('/')[0]
        if (!first) continue
        const entryPath = scope ? `${scope}/${first}` : first
        entries.set(entryPath, remainder.includes('/') ? 'directory' : 'file')
        if (entries.size >= limit) break
      }
      return [...entries].map(([path, type]) => ({ path, type }))
    },
    grep: async ({ pattern, path: rawScope, glob, literal, context = 0, limit }) => {
      const scope = normalizePath(rawScope ?? '', true)
      const expression = new RegExp(literal ? escapeRegex(pattern) : pattern)
      const matches: WorkspaceMatch[] = []
      for (const path of await listFilePaths()) {
        if (matches.length >= limit || !pathInScope(path, scope)) continue
        if (
          glob &&
          !workspaceGlobMatches(glob, path) &&
          !workspaceGlobMatches(glob, path.split('/').at(-1) ?? path)
        )
          continue
        const result = await storageClient.get({ namespace, id: path })
        if (result.value === null) continue
        const lines = parseStoredFile(result.value, path)
          .content.replace(/\r\n?/g, '\n')
          .split('\n')
        for (let index = 0; index < lines.length && matches.length < limit; index += 1) {
          const text = lines[index] ?? ''
          expression.lastIndex = 0
          if (!expression.test(text)) continue
          matches.push({
            path,
            line: index + 1,
            text,
            ...(context > 0 ? { before: lines.slice(Math.max(0, index - context), index) } : {}),
            ...(context > 0 ? { after: lines.slice(index + 1, index + 1 + context) } : {}),
          })
        }
      }
      return matches
    },
  }
}
