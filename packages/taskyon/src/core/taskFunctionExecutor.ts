import { sha256UrlSafeHash } from '../utils/encoding'

export async function generateSecretId(
  taskId: string | undefined,
  tool: { name: string; code?: unknown; function?: unknown },
) {
  return tool.name + ':' + (taskId ?? (await sha256UrlSafeHash(tool.code ?? tool.function)))
}
