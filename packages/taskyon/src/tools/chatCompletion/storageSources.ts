import z from 'zod'
import type { Annotation, TaskNode } from '../../types/taskNode'

const storageBlobMetadata = z.object({
  size: z.number().int().nonnegative(),
  contentType: z.string().optional(),
  sha256: z.string().optional(),
})

const storageToolResult = z.object({
  success: z.literal(true),
  namespace: z.string(),
  id: z.string(),
  url: z.string().optional(),
  sourceUrl: z.string().optional(),
  metadata: storageBlobMetadata.optional(),
})

export const storageResultToAnnotation = (data: unknown): Annotation | undefined => {
  const parsed = storageToolResult.safeParse(data)
  if (!parsed.success) return undefined

  const { namespace, id, metadata } = parsed.data
  const sourceUrl = parsed.data.sourceUrl ?? parsed.data.url
  return {
    type: 'storage-file',
    namespace,
    id,
    ...(metadata?.contentType ? { mediaType: metadata.contentType } : {}),
    ...(metadata?.size === undefined ? {} : { size: metadata.size }),
    ...(metadata?.sha256 ? { sha256: metadata.sha256 } : {}),
    ...(sourceUrl ? { sourceUrl } : {}),
  }
}

export const collectStorageFileAnnotations = (taskChain: readonly TaskNode[]): Annotation[] => {
  const lastAssistantIndex = taskChain.findLastIndex(
    (task) =>
      task.role === 'assistant' &&
      (task.content.type === 'message' || task.content.type === 'structured'),
  )
  const relevantTasks = lastAssistantIndex >= 0 ? taskChain.slice(lastAssistantIndex + 1) : taskChain
  const annotations = new Map<string, Annotation>()

  for (const task of relevantTasks) {
    if (task.content.type !== 'toolresult') continue
    const annotation = storageResultToAnnotation(task.content.data)
    if (annotation?.type !== 'storage-file') continue
    annotations.set(`${annotation.namespace}/${annotation.id}`, annotation)
  }

  return [...annotations.values()]
}
