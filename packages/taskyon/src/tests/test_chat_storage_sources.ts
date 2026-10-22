import type { TaskNode } from '../types/taskNode'
import {
  collectStorageFileAnnotations,
  storageResultToAnnotation,
} from '../tools/chatCompletion/storageSources'

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

const storageDownloadResult = {
  success: true,
  namespace: 'tool-files',
  id: 'aea-september-2026-elementary-menu.pdf',
  url: 'https://www.aeacs.org/wp-content/uploads/2026/08/2026-september-Elementary-1.pdf',
  metadata: {
    id: 'aea-september-2026-elementary-menu.pdf',
    size: 123456,
    contentType: 'application/pdf',
    modifiedAt: '2026-10-21T00:00:00.000Z',
    sha256: 'sha256:abc',
  },
}

export const testStorageResultConvertsToStoredFileAnnotation = () => {
  const annotation = storageResultToAnnotation(storageDownloadResult)

  assert(annotation?.type === 'storage-file', 'Expected a storage-file annotation')
  assert(annotation.namespace === 'tool-files', 'Expected the storage namespace')
  assert(annotation.id === 'aea-september-2026-elementary-menu.pdf', 'Expected the object id')
  assert(annotation.mediaType === 'application/pdf', 'Expected the stored media type')
  assert(annotation.size === 123456, 'Expected the stored size')
  assert(annotation.sha256 === 'sha256:abc', 'Expected the stored content hash')
  assert(annotation.sourceUrl === storageDownloadResult.url, 'Expected the original download URL')
}

testStorageResultConvertsToStoredFileAnnotation.description =
  'Converts a storage download result into a stored-file annotation.'

export const testStorageFileAnnotationsAttachOnlyToTheLatestAnswer = () => {
  const tasks: TaskNode[] = [
    { id: 'user', role: 'user', content: { type: 'message', data: 'Download the menu' } },
    { id: 'old-answer', role: 'assistant', content: { type: 'message', data: 'Looking it up' } },
    {
      id: 'old-result',
      role: 'system',
      content: {
        type: 'toolresult',
        data: { ...storageDownloadResult, id: 'old-menu.pdf' },
      },
    },
    { id: 'answer', role: 'assistant', content: { type: 'message', data: 'Saved the menu' } },
    { id: 'follow-up', role: 'user', content: { type: 'message', data: 'And now?' } },
    {
      id: 'new-result',
      role: 'system',
      content: { type: 'toolresult', data: storageDownloadResult },
    },
  ]

  const annotations = collectStorageFileAnnotations(tasks)

  assert(annotations.length === 1, `Expected one stored-file annotation, got ${annotations.length}`)
  assert(
    annotations[0]?.type === 'storage-file' &&
      annotations[0].id === storageDownloadResult.id,
    'Expected only the storage result after the latest assistant message',
  )
}

testStorageFileAnnotationsAttachOnlyToTheLatestAnswer.description =
  'Attaches only storage results produced after the latest assistant message.'

export const testStorageFileAnnotationsIgnoreNonStorageResults = () => {
  assert(
    storageResultToAnnotation({ success: true, answer: 42 }) === undefined,
    'Expected non-storage tool results to be ignored',
  )
  assert(storageResultToAnnotation(null) === undefined, 'Expected null tool results to be ignored')
  assert(
    storageResultToAnnotation({ success: false, namespace: 'tool-files', id: 'x.pdf' }) ===
      undefined,
    'Expected failed storage results to be ignored',
  )
}

testStorageFileAnnotationsIgnoreNonStorageResults.description =
  'Ignores tool results that are not successful storage objects.'
