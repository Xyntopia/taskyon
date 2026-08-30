import type { TaskNode } from '../types/taskNode'

export type RequestedStorageTarget = {
  namespace: string
  objectId: string
  expectedFileType?: 'pdf'
}

const normalizeStorageIdentifier = (value: string | undefined) => {
  const normalized = value?.trim().replace(/\\/g, '/')
  if (!normalized || normalized.startsWith('/') || normalized.includes('..')) return undefined
  if (!/^[A-Za-z0-9][A-Za-z0-9._~/-]*$/.test(normalized)) return undefined
  return normalized.replace(/[.,;:!?]+$/, '') || undefined
}

export const storageTargetFromArguments = (args: {
  storageNamespace?: string | undefined
  storageObjectId?: string | undefined
  storageExpectedFileType?: 'pdf' | undefined
}) => {
  const namespace = normalizeStorageIdentifier(args.storageNamespace)
  const objectId = normalizeStorageIdentifier(args.storageObjectId)
  if (!namespace || !objectId) return undefined
  return {
    namespace,
    objectId,
    ...(args.storageExpectedFileType
      ? { expectedFileType: args.storageExpectedFileType }
      : objectId.toLowerCase().endsWith('.pdf')
        ? { expectedFileType: 'pdf' as const }
        : {}),
  }
}

export const extractStorageTarget = (text: string): RequestedStorageTarget | undefined => {
  const normalizedText = text
    .replace(/-\s+(?=[A-Za-z0-9])/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
  const namespace = normalizeStorageIdentifier(
    normalizedText.match(
      /\b(?:exact\s+logical\s+)?(?:storage\s+)?namespace\s+(?:(?:is|of|with)\s+)?(?!under\b|the\b|for\b)([A-Za-z0-9][A-Za-z0-9._~/-]*)/i,
    )?.[1] ??
      normalizedText.match(
        /\bin\s+(?:the\s+)?([A-Za-z0-9][A-Za-z0-9._~/-]*)\s+storage\s+namespace\b/i,
      )?.[1],
  )
  const objectId = normalizeStorageIdentifier(
    normalizedText.match(
      /\b(?:exact\s+)?object\s+id\s+(?:(?:is|of)\s+)?([A-Za-z0-9][A-Za-z0-9._~/-]*)/i,
    )?.[1],
  )
  if (!namespace || !objectId) return undefined
  return {
    namespace,
    objectId,
    ...(objectId.toLowerCase().endsWith('.pdf') ? { expectedFileType: 'pdf' as const } : {}),
  }
}

export const resolveStorageTargetFromTaskChain = (taskChain: readonly TaskNode[]) => {
  const latestUserMessage = [...taskChain]
    .reverse()
    .find(
      (task) =>
        task.role === 'user' &&
        task.content.type === 'message' &&
        typeof task.content.data === 'string',
    )
  return latestUserMessage?.content.type === 'message' &&
    typeof latestUserMessage.content.data === 'string'
    ? extractStorageTarget(latestUserMessage.content.data)
    : undefined
}
