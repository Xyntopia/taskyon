import type { MarkdownExtension } from '@taskyon/common/modules/markdownUtils '
import type { Annotation } from '@taskyon/taskyon/api'

export type StorageFileAnnotation = Extract<Annotation, { type: 'storage-file' }>

type MarkdownPlugin = NonNullable<MarkdownExtension['plugins']>[number]
type MarkdownItInstance = Parameters<MarkdownPlugin>[0]
type MarkdownState = Parameters<Parameters<MarkdownItInstance['core']['ruler']['push']>[1]>[0]
type MarkdownToken = MarkdownState['tokens'][number]

export const storageFileManagerRoute = (file: Pick<StorageFileAnnotation, 'namespace' | 'id'>) =>
  `/storage?namespace=${encodeURIComponent(file.namespace)}&kind=blob&id=${encodeURIComponent(file.id)}`

export const storageFileLabel = (file: StorageFileAnnotation) => file.name ?? file.id

const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

const makeTextToken = (state: MarkdownState, content: string) => {
  const token = new state.Token('text', '', 0)
  token.content = content
  return token
}

const wrapInLink = (state: MarkdownState, token: MarkdownToken, route: string) => {
  const open = new state.Token('link_open', 'a', 1)
  open.attrSet('href', route)
  return [open, token, new state.Token('link_close', 'a', -1)]
}

const linkifyTextToken = (
  state: MarkdownState,
  token: MarkdownToken,
  routes: Map<string, string>,
  pattern: RegExp,
): MarkdownToken[] => {
  const parts = token.content.split(pattern)
  if (parts.length === 1) return [token]
  return parts.flatMap((part) => {
    if (!part) return []
    const route = routes.get(part)
    const text = makeTextToken(state, part)
    return route ? wrapInLink(state, text, route) : [text]
  })
}

const linkifyInlineChildren = (
  state: MarkdownState,
  token: MarkdownToken,
  routes: Map<string, string>,
  pattern: RegExp,
) => {
  token.children =
    token.children?.flatMap((child) => {
      if (child.type === 'code_inline') {
        const route = routes.get(child.content)
        return route ? wrapInLink(state, child, route) : [child]
      }
      if (child.type !== 'text') return [child]
      return linkifyTextToken(state, child, routes, pattern)
    }) ?? null
}

const createStorageFilePlugin =
  (routes: Map<string, string>, names: string[]): MarkdownPlugin =>
  (md) => {
    if (names.length === 0) return
    const pattern = new RegExp(`(${names.map(escapeRegExp).join('|')})`, 'g')
    md.core.ruler.push('taskyon_storage_file_links', (state) => {
      for (const token of state.tokens) {
        if (token.type !== 'inline' || !token.children) continue
        linkifyInlineChildren(state, token, routes, pattern)
      }
    })
  }

export const createStorageFileLinkExtension = (
  files: readonly StorageFileAnnotation[],
): MarkdownExtension => {
  const routes = new Map<string, string>()
  for (const file of files) {
    const route = storageFileManagerRoute(file)
    routes.set(storageFileLabel(file), route)
    routes.set(file.id, route)
  }
  const names = [...routes.keys()].filter(Boolean).sort((a, b) => b.length - a.length)
  return {
    name: 'taskyon-storage-file-links',
    plugins: [createStorageFilePlugin(routes, names)],
  }
}
