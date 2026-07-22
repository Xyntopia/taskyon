import {
  compareDocumentationPaths,
  createDocumentationDocument,
  parseDocumentationMarkdown,
  resolveDocumentationDocumentId,
  searchDocumentation,
} from './documentation'
import { createDocumentationBaseStore } from './documentationBases'
import type { DocumentationManifest } from './resourceFiles'

const assert = (condition: unknown, message: string) => {
  if (!condition) throw new Error(message)
}

export const testDocumentationInfersMarkdownTitleWithoutFrontmatter = () => {
  const parsed = parseDocumentationMarkdown('# Example Guide\n\nContent.\n', 'guides/example.md')
  assert(parsed.title === 'Example Guide', 'Expected the first H1 to provide the title.')
  assert(
    parsed.content.startsWith('# Example Guide'),
    'Expected Markdown content to remain intact.',
  )
  return { success: true }
}

export const testDocumentationIgnoresOptionalFrontmatter = () => {
  const parsed = parseDocumentationMarkdown(
    '---\ntitle: Ignored Title\ncustom: value\n---\n\n# Visible Title\n\nContent.\n',
    'guides/frontmatter.md',
  )
  assert(parsed.title === 'Visible Title', 'Expected the Markdown H1 to remain authoritative.')
  assert(!parsed.content.includes('custom: value'), 'Expected optional frontmatter to be removed.')
  return { success: true }
}

export const testDocumentationFallsBackToHumanizedFilename = () => {
  const parsed = parseDocumentationMarkdown(
    'Content without a heading.\n',
    'guides/01-first_steps.md',
  )
  assert(parsed.title === 'First steps', 'Expected a humanized filename fallback.')
  return { success: true }
}

export const testDocumentationResolvesExactDocumentIds = () => {
  const document = createDocumentationDocument({
    path: 'user/task-trees.md',
    url: '/docs/user/task-trees.md',
    content: '# Task Trees',
    chapters: ['User', 'Workflows'],
  })
  assert(
    resolveDocumentationDocumentId([document], 'user/task-trees.md') === 'user/task-trees.md',
    'Expected the exact document ID to resolve.',
  )
  assert(
    resolveDocumentationDocumentId([document], 'user/task-trees') === undefined,
    'Expected document routes to require the exact ID, including its extension.',
  )
  assert(
    document.chapters.join('/') === 'User/Workflows',
    'Expected the manifest chapter path to remain on the document.',
  )
  return { success: true }
}

export const testDocumentationUsesNaturalPathOrder = () => {
  const paths = ['guides/10-later.md', 'guides/02-next.md', 'guides/index.md', 'guides/01-first.md']
  paths.sort(compareDocumentationPaths)
  assert(paths[0] === 'guides/index.md', 'Expected the folder index first.')
  assert(paths[1] === 'guides/01-first.md', 'Expected natural numeric filename ordering.')
  assert(paths[2] === 'guides/02-next.md', 'Expected the second numeric filename next.')
  return { success: true }
}

export const testDocumentationSearchSupportsLiteralAndRegexQueries = () => {
  const documents = [
    createDocumentationDocument({
      path: 'guides/workflows.md',
      url: '/docs/example/guides/workflows',
      content: '# Workflow Guide\n\nTask trees keep related work inspectable.',
    }),
    createDocumentationDocument({
      path: 'reference/storage.md',
      url: '/docs/example/reference/storage',
      content: '# Storage\n\nArtifacts are stored by content hash.',
    }),
  ]

  const literal = searchDocumentation(documents, {
    query: 'task trees',
    mode: 'literal',
    limit: 5,
  })
  const regex = searchDocumentation(documents, {
    query: 'content\\s+hash',
    mode: 'regex',
    limit: 5,
  })

  assert(literal[0]?.documentId === 'guides/workflows.md', 'Expected literal content search.')
  assert(regex[0]?.documentId === 'reference/storage.md', 'Expected regular-expression search.')
  assert(literal[0]?.url === '/docs/example/guides/workflows', 'Expected source URLs on hits.')
  return { success: true }
}

export const testDocumentationSearchRejectsInvalidRegex = () => {
  const document = createDocumentationDocument({
    path: 'guide.md',
    url: '/docs/example/guide',
    content: '# Guide\n\nContent.',
  })
  let message = ''
  try {
    searchDocumentation([document], { query: '[', mode: 'regex', limit: 5 })
  } catch (error) {
    message = error instanceof Error ? error.message : String(error)
  }
  assert(message.includes('Invalid documentation search regex'), 'Expected a useful regex error.')
  return { success: true }
}

export const testDocumentationBasesGenerateStableRoutesAndHandleCollisions = async () => {
  const records = new Map<string, DocumentationManifest>()
  const store = createDocumentationBaseStore(
    {
      get: (id) => Promise.resolve(records.get(id) ?? null),
      set: (id, manifest) => {
        records.set(id, manifest)
        return Promise.resolve()
      },
      delete: (id) => {
        records.delete(id)
        return Promise.resolve()
      },
      list: () => Promise.resolve(Array.from(records, ([id, data]) => ({ id, data }))),
    },
    () =>
      Promise.resolve([
        createDocumentationDocument({
          path: 'guides/getting-started.md',
          url: 'https://example.com/source.md',
          content: '# Getting Started',
        }),
      ]),
  )
  const first = { internal: [], external: ['https://example.com/project/docs.json'] }
  const collision = { internal: [], external: ['https://another.example/project/docs.json'] }
  const initial = await store.register(first)
  const updated = await store.register(first)
  const second = await store.register(collision)
  const [document] = await store.load(initial.id)

  assert(initial.id === 'docs', 'Expected a readable slug from the source filename.')
  assert(updated.id === initial.id, 'Expected the same sources to retain their documentation ID.')
  assert(second.id.startsWith('docs-'), 'Expected a short hash suffix for slug collisions.')
  assert(initial.url === '/docs/docs', 'Expected the canonical documentation base route.')
  assert(
    document?.url === '/docs/docs/guides/getting-started.md',
    'Expected loaded documents to use their canonical documentation viewer route.',
  )
  return { success: true }
}

export const testDocumentationBasesReplaceExplicitIdWithoutReadingStoredValue = async () => {
  const manifest: DocumentationManifest = {
    internal: ['/docs/current.md'],
    external: [],
  }
  let stored: DocumentationManifest | undefined
  let listed = false
  const store = createDocumentationBaseStore(
    {
      get: () => Promise.resolve(null),
      set: (_id, value) => {
        stored = value
        return Promise.resolve()
      },
      delete: () => Promise.resolve(),
      list: () => {
        listed = true
        return Promise.resolve([
          {
            id: 'taskyon',
            data: { internal: [{ url: '/docs/old.md', aliases: [] }], external: [] },
          },
        ])
      },
    },
    () => Promise.resolve([]),
  )

  const registered = await store.register(manifest, 'taskyon')

  assert(registered.id === 'taskyon', 'Expected the explicit documentation base ID.')
  assert(
    JSON.stringify(stored) === JSON.stringify(manifest),
    'Expected the explicit base manifest to replace the stored value.',
  )
  assert(!listed, 'Expected explicit registration not to parse existing documentation bases.')
  return { success: true }
}

testDocumentationInfersMarkdownTitleWithoutFrontmatter.description =
  'Infers a documentation title from the first Markdown H1 without requiring frontmatter.'
testDocumentationIgnoresOptionalFrontmatter.description =
  'Removes optional third-party frontmatter without using it as documentation metadata.'
testDocumentationFallsBackToHumanizedFilename.description =
  'Falls back to a humanized filename when a document has no H1.'
testDocumentationResolvesExactDocumentIds.description =
  'Resolves exact document IDs without compatibility aliases or extension rewriting.'
testDocumentationUsesNaturalPathOrder.description =
  'Orders folder indexes first and applies natural numeric path ordering.'
testDocumentationSearchSupportsLiteralAndRegexQueries.description =
  'Uses one shared documentation search for literal and regular-expression queries.'
testDocumentationSearchRejectsInvalidRegex.description =
  'Rejects malformed documentation regular expressions with a useful error.'
testDocumentationBasesGenerateStableRoutesAndHandleCollisions.description =
  'Generates stable documentation base routes and disambiguates source slug collisions.'
testDocumentationBasesReplaceExplicitIdWithoutReadingStoredValue.description =
  'Replaces an explicitly named documentation base without reading an obsolete stored manifest.'
