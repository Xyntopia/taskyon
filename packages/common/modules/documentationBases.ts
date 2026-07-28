import { canonicalHash } from './canonicalHash'
import {
  documentationBaseUrl,
  documentationDocumentUrl,
  type LoadedDocumentationDocument,
} from './documentation'
import {
  flattenDocumentationManifestSources,
  parseDocumentationManifest,
  type DocumentationManifest,
} from './resourceFiles'

export type DocumentationManifestStorage = {
  get: (id: string) => Promise<unknown>
  set: (id: string, manifest: DocumentationManifest) => Promise<void>
  delete: (id: string) => Promise<void>
  list: () => Promise<Array<{ id: string; data: unknown }>>
}

export type DocumentationBase = {
  id: string
  manifest: DocumentationManifest
}

const manifestSources = (manifest: DocumentationManifest) =>
  flattenDocumentationManifestSources(manifest).map(({ source }) => source)

const sourceSlug = (manifest: DocumentationManifest) => {
  const source = manifestSources(manifest)[0] ?? 'documentation'
  const path = source.replace(/[?#].*$/, '').replace(/\/+$/, '')
  const candidate = path.split('/').filter(Boolean).at(-1) ?? 'documentation'
  return (
    candidate
      .replace(/\.(md|mdx|json|ya?ml)$/i, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'documentation'
  )
}

const sameSources = (left: DocumentationManifest, right: DocumentationManifest) =>
  JSON.stringify(manifestSources(left)) === JSON.stringify(manifestSources(right))

export const createDocumentationBaseStore = (
  storage: DocumentationManifestStorage,
  loadDocuments: (manifest: DocumentationManifest) => Promise<LoadedDocumentationDocument[]>,
) => {
  const list = async (): Promise<DocumentationBase[]> =>
    (await storage.list()).map(({ id, data }) => ({
      id,
      manifest: parseDocumentationManifest(data),
    }))

  const register = async (manifest: DocumentationManifest, preferredId?: string) => {
    const parsed = parseDocumentationManifest(manifest)
    if (preferredId) {
      await storage.set(preferredId, parsed)
      return { id: preferredId, url: documentationBaseUrl(preferredId) }
    }
    const bases = await list()
    const existing = bases.find((base) => sameSources(base.manifest, parsed))
    const slug = existing?.id ?? sourceSlug(parsed)
    const collision = bases.find((base) => base.id === slug && !sameSources(base.manifest, parsed))
    const hashStart = 'sha256:'.length
    const id = collision ? `${slug}-${canonicalHash(parsed).slice(hashStart, hashStart + 8)}` : slug
    await storage.set(id, parsed)
    return { id, url: documentationBaseUrl(id) }
  }

  const get = async (id: string) => {
    const stored = await storage.get(id)
    return stored === null ? null : { id, manifest: parseDocumentationManifest(stored) }
  }

  return {
    get,
    list,
    register,
    remove: storage.delete,
    load: async (id: string) => {
      const base = await get(id)
      if (!base) throw new Error(`Documentation base not found: ${id}`)
      return (await loadDocuments(base.manifest)).map((document) => ({
        ...document,
        url: documentationDocumentUrl(id, document.id),
      }))
    },
  }
}

export type DocumentationBaseStore = ReturnType<typeof createDocumentationBaseStore>
