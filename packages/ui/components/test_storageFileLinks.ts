import MarkdownIt from 'markdown-it'
import {
  createStorageFileLinkExtension,
  storageFileManagerRoute,
  type StorageFileAnnotation,
} from './taskyon/storageFileLinks'

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

const storedMenu: StorageFileAnnotation = {
  type: 'storage-file',
  namespace: 'tool-files',
  id: 'menu.pdf',
  size: 42,
  mediaType: 'application/pdf',
}

const renderWithStoredFiles = (markdown: string, files: StorageFileAnnotation[]) => {
  const plugin = createStorageFileLinkExtension(files).plugins?.[0]
  assert(plugin, 'Expected the storage-file link extension to provide a plugin')
  const md = new MarkdownIt()
  md.use(plugin)
  return md.render(markdown)
}

export const testStorageFileRouteEncodesNamespaceAndId = () => {
  const route = storageFileManagerRoute({ namespace: 'tool-files', id: 'menu 1.pdf' })
  assert(
    route === '/storage?namespace=tool-files&kind=blob&id=menu%201.pdf',
    `Expected an encoded file-manager route, got ${route}`,
  )
}

testStorageFileRouteEncodesNamespaceAndId.description =
  'Builds the file-manager route for a stored-file annotation.'

export const testStorageFileLinksApplyToTextAndCodeSpans = () => {
  const html = renderWithStoredFiles('Saved as `menu.pdf`, see menu.pdf again.', [storedMenu])
  const href = 'href="/storage?namespace=tool-files&amp;kind=blob&amp;id=menu.pdf"'

  assert(html.includes(`<a ${href}><code>menu.pdf</code></a>`), `Expected a linked code span, got ${html}`)
  assert(html.includes(`<a ${href}>menu.pdf</a>`), `Expected a linked plain reference, got ${html}`)
}

testStorageFileLinksApplyToTextAndCodeSpans.description =
  'Links stored-file names in plain text and inline code spans.'

export const testStorageFileLinksLeaveUnrelatedMessagesAlone = () => {
  const html = renderWithStoredFiles('Saved as `menu.pdf`.', [])
  assert(!html.includes('<a '), `Expected no links without stored files, got ${html}`)

  const unrelated = renderWithStoredFiles('Nothing to link here.', [storedMenu])
  assert(!unrelated.includes('<a '), `Expected unrelated text to stay unlinked, got ${unrelated}`)
}

testStorageFileLinksLeaveUnrelatedMessagesAlone.description =
  'Leaves messages without matching stored-file references unchanged.'
