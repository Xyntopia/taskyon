import {
  loadDocumentationManifestFiles,
  type LoadedResourceFile,
  type ResourceFilesLoader,
} from './resourceFiles'

const assert = (condition: unknown, message: string) => {
  if (!condition) throw new Error(message)
}

const textFile = (url: string, content: string): LoadedResourceFile => ({
  url,
  file: new File([content], url.split('/').at(-1) ?? 'document.txt', {
    type: 'text/plain',
  }),
})

export const testDocumentationManifestExpandsSourcesIntoFiles = async () => {
  const loadFiles: ResourceFilesLoader = async function* (source) {
    if (source === '/docs/') {
      yield await Promise.resolve(textFile('/docs/one.md', '# One'))
      yield await Promise.resolve(textFile('/docs/nested/two.md', '# Two'))
      return
    }
    yield await Promise.resolve(textFile(source, 'External'))
  }

  const result = await loadDocumentationManifestFiles(
    {
      internal: ['/docs/'],
      external: ['https://example.com/reference.txt'],
    },
    loadFiles,
  )

  assert(result.errors.length === 0, 'Expected manifest expansion without errors.')
  assert(result.files.length === 3, 'Expected every file yielded by both sources.')
  assert(
    result.files.filter((entry) => entry.cache === 'internal').length === 2,
    'Expected files expanded from the internal directory to inherit internal caching.',
  )
  assert(
    result.files.some(
      (entry) => entry.cache === 'external' && entry.url === 'https://example.com/reference.txt',
    ),
    'Expected the external source to inherit external caching.',
  )

  return { success: true }
}

export const testDocumentationManifestKeepsSuccessfulSourcesWhenOneFails = async () => {
  const loadFiles: ResourceFilesLoader = async function* (source) {
    if (source === '/missing/') throw new Error('not found')
    yield await Promise.resolve(textFile('/docs/available.md', '# Available'))
  }

  const result = await loadDocumentationManifestFiles(
    { internal: ['/missing/', '/docs/'], external: [] },
    loadFiles,
  )

  assert(result.files.length === 1, 'Expected successful sources to remain available.')
  assert(result.errors.length === 1, 'Expected the failed source to be reported.')
  assert(result.errors[0]?.source === '/missing/', 'Expected the failed source URL in the error.')

  return { success: true }
}

export const testDocumentationManifestPreservesChapterOrderAndPaths = async () => {
  const loadFiles: ResourceFilesLoader = async function* (source) {
    yield await Promise.resolve(textFile(source, `# ${source}`))
  }

  const result = await loadDocumentationManifestFiles(
    {
      internal: [
        {
          User: [
            '/docs/index.md',
            '/docs/getting-started.md',
            {
              Workflows: ['/docs/task-trees.md', '/docs/prompting.md'],
            },
          ],
        },
      ],
      external: [],
    },
    loadFiles,
  )

  assert(result.errors.length === 0, 'Expected nested manifest chapters to load.')
  assert(
    result.files.map((entry) => entry.url).join(',') ===
      '/docs/index.md,/docs/getting-started.md,/docs/task-trees.md,/docs/prompting.md',
    'Expected manifest array order to define document order.',
  )
  assert(
    result.files[0]?.chapters.join('/') === 'User' &&
      result.files[2]?.chapters.join('/') === 'User/Workflows',
    'Expected each file to retain its nested manifest chapter path.',
  )

  return { success: true }
}

testDocumentationManifestExpandsSourcesIntoFiles.description =
  'Expands file or directory manifest sources into files without resource-kind metadata.'
testDocumentationManifestKeepsSuccessfulSourcesWhenOneFails.description =
  'Reports source-level failures without discarding files loaded from other sources.'
testDocumentationManifestPreservesChapterOrderAndPaths.description =
  'Preserves array order and chapter paths while flattening a recursive documentation manifest.'
