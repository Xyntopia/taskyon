import type { TaskNode } from '../types/taskNode'
import { sha256UrlSafeHash } from '../utils/encoding'

export function findCallingToolReference(taskChain: TaskNode[], currentToolName: string) {
  const caller = [...taskChain]
    .reverse()
    .find(
      (task) => task.content.type === 'functioncall' && task.content.data.name !== currentToolName,
    )
  if (caller?.content.type !== 'functioncall') return null
  return {
    name: caller.content.data.name,
    ...(caller.content.data.toolRevision ? { revision: caller.content.data.toolRevision } : {}),
  }
}

export async function generateSecretId(
  taskId: string | undefined,
  tool: { name: string; code?: unknown; function?: unknown },
) {
  const revision =
    taskId ??
    (await sha256UrlSafeHash({
      name: tool.name,
      code: tool.code,
      functionSource: typeof tool.function === 'function' ? tool.function.toString() : undefined,
    }))
  const readableId = `${tool.name}:${revision}`
  return readableId.length <= 64 ? readableId : `tool:${await sha256UrlSafeHash(readableId)}`
}
