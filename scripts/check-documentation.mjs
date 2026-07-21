import { readdir, readFile } from 'node:fs/promises'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  createDocumentationDocument,
  resolveDocumentationDocumentId,
} from '../packages/common/modules/documentation.ts'
import {
  documentationSourceAliases,
  documentationSourceUrl,
  flattenDocumentationManifestSources,
} from '../packages/common/modules/resourceFiles.ts'
import { taskyonDocumentationManifest } from '../packages/taskyon/src/documentationManifest.ts'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const docsRoot = join(root, 'public', 'docs')
const failures = []

const listFiles = async (directory) => {
  const entries = await readdir(directory, { withFileTypes: true })
  const files = await Promise.all(
    entries.map(async (entry) => {
      const path = join(directory, entry.name)
      return entry.isDirectory() ? await listFiles(path) : [path]
    }),
  )
  return files.flat()
}

const documentedEntries = flattenDocumentationManifestSources(taskyonDocumentationManifest)
  .map(({ source: entry, chapters }) => ({
    source: documentationSourceUrl(entry),
    aliases: documentationSourceAliases(entry),
    chapters,
  }))
  .filter(({ source }) => source.startsWith('/docs/'))
  .map(({ source, aliases, chapters }) => ({
    source,
    aliases,
    chapters,
    file: resolve(docsRoot, source.slice('/docs/'.length)),
  }))

const activeEntries = (
  await Promise.all(
    documentedEntries.map(async ({ file, aliases, chapters }) => {
      const entries = await readdir(file, { withFileTypes: true }).catch(() => undefined)
      const files = entries ? await listFiles(file) : [file]
      return files.map((activeFile) => ({
        file: activeFile,
        aliases: files.length === 1 ? aliases : [],
        chapters,
      }))
    }),
  )
)
  .flat()
  .filter(({ file }) => file.endsWith('.md'))
  .sort((left, right) => left.file.localeCompare(right.file))

const activeFiles = activeEntries.map(({ file }) => file)
const documents = []
for (const { file, aliases, chapters } of activeEntries) {
  const path = relative(docsRoot, file).replaceAll('\\', '/')
  try {
    documents.push(
      createDocumentationDocument({
        path,
        url: `/docs/${path}`,
        content: await readFile(file, 'utf8'),
        aliases,
        chapters,
      }),
    )
  } catch (error) {
    failures.push(error instanceof Error ? error.message : String(error))
  }
}

const aliases = new Map()
for (const document of documents) {
  for (const alias of [document.id, ...document.aliases]) {
    const normalized = alias.replace(/^\/?(docs\/)?/, '').replace(/\.md$/, '')
    const owner = aliases.get(normalized)
    if (owner && owner !== document.id) {
      failures.push(`${document.path}: alias "${alias}" is already owned by ${owner}.`)
    }
    aliases.set(normalized, document.id)
  }
}

const markdownLinkPattern = /\[[^\]]*\]\(([^)\s]+)(?:\s+[^)]*)?\)/g
for (const document of documents) {
  for (const match of document.content.matchAll(markdownLinkPattern)) {
    const href = match[1]?.replace(/^<|>$/g, '')
    if (!href || /^(https?:|mailto:|#|data:)/.test(href)) continue
    const withoutAnchor = decodeURIComponent(href.split('#')[0]?.split('?')[0] ?? '')
    if (withoutAnchor.startsWith('/docs/')) {
      if (!resolveDocumentationDocumentId(documents, withoutAnchor.slice('/docs/'.length))) {
        failures.push(`${document.path}: unresolved documentation link ${href}.`)
      }
      continue
    }
    if (withoutAnchor.startsWith('/')) continue
    const target = resolve(dirname(join(docsRoot, document.path)), withoutAnchor)
    try {
      await readFile(target)
    } catch {
      failures.push(`${document.path}: unresolved relative link ${href}.`)
    }
  }
}

const activeFileSet = new Set(activeFiles)
for (const file of (await listFiles(docsRoot)).filter((path) => path.endsWith('.md'))) {
  if (!activeFileSet.has(file)) {
    failures.push(`${relative(root, file)} is not covered by the documentation manifest.`)
  }
}

if (failures.length > 0) {
  console.error(`Documentation check failed with ${failures.length} issue(s):`)
  failures.forEach((failure) => console.error(`- ${failure}`))
  process.exitCode = 1
} else {
  console.log(`Documentation check passed for ${documents.length} active documents.`)
}
