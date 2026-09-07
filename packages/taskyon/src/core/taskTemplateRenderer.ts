import {
  createJinjaTemplateRenderer,
  jinjaSandboxSource,
} from '@taskyon/common/modules/sandbox/jinjaTemplate'
import { jinjaArtifact } from '@taskyon/common/modules/sandbox/jinjaArtifact'
import { TASK_REF_PREFIX, taskRefToTaskId } from './taskVariables'
import type { TaskGetter } from '../types/taskNode'
import type { CrudWrapper } from '../utils/crudWrapper'

export const TASK_TEMPLATE_CACHE_MAX_BYTES = 10 * 1024 * 1024

const TASK_TEMPLATE_RENDERER_VERSION = 'jinja-task-v2'
const STABLE_TASK_REF_REGEX = /tasks\s*\[\s*["'](_t:[A-Za-z0-9_-]+)["']\s*\]/g

const sha256 = async (value: string) => {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
}

const extractTemplateTaskIds = (template: string) => {
  const taskIds = new Set<string>()
  for (const match of template.matchAll(STABLE_TASK_REF_REGEX)) {
    const taskId = taskRefToTaskId(match[1] ?? '')
    if (taskId) taskIds.add(taskId)
  }
  return Array.from(taskIds).sort()
}

const serializedByteLength = (value: unknown) =>
  new TextEncoder().encode(JSON.stringify(value)).byteLength

type TemplateCacheEntry = {
  accessedAt: number
  value: string
}

export const createPersistentTaskTemplateCache = (options: {
  storage: Pick<CrudWrapper<TemplateCacheEntry>, 'delete' | 'get' | 'list' | 'set'>
  maxBytes?: number
  now?: () => number
}) => {
  const maxBytes = options.maxBytes ?? TASK_TEMPLATE_CACHE_MAX_BYTES
  const now = options.now ?? Date.now
  let pending = Promise.resolve()
  const runExclusive = <T>(operation: () => Promise<T>) => {
    const result = pending.then(operation, operation)
    pending = result.then(
      () => undefined,
      () => undefined,
    )
    return result
  }
  const entrySize = (entry: TemplateCacheEntry) => serializedByteLength(entry)

  const evictToBudget = async () => {
    const entries = (await options.storage.list()).map(({ id, data }) => ({ id, data }))
    let totalBytes = entries.reduce((total, entry) => total + entrySize(entry.data), 0)
    for (const entry of entries.sort(
      (left, right) =>
        left.data.accessedAt - right.data.accessedAt ||
        String(left.id).localeCompare(String(right.id)),
    )) {
      if (totalBytes <= maxBytes) break
      await options.storage.delete(entry.id)
      totalBytes -= entrySize(entry.data)
    }
  }

  return {
    get: (id: string) =>
      runExclusive(async () => {
        const entry = await options.storage.get(id)
        if (!entry) return undefined
        await options.storage.set(id, { ...entry, accessedAt: now() })
        return entry.value
      }),
    set: (id: string, value: string) =>
      runExclusive(async () => {
        const entry = { accessedAt: now(), value }
        if (entrySize(entry) > maxBytes) {
          await options.storage.delete(id)
          return
        }
        await options.storage.set(id, entry)
        await evictToBudget()
      }),
  }
}

export const createTaskTemplateRenderer = (options: {
  getTaskById: TaskGetter
  cache?: {
    get(id: string): Promise<string | undefined>
    set(id: string, value: string): Promise<void>
  }
}) => {
  const renderJinja = createJinjaTemplateRenderer()

  return {
    render: async (template: string, stopSignal = new AbortController().signal) => {
      const taskIds = extractTemplateTaskIds(template)
      if (taskIds.length === 0) return template

      const cacheKey = await sha256(
        `${TASK_TEMPLATE_RENDERER_VERSION}\u0000${jinjaArtifact.id}\u0000${jinjaSandboxSource}\u0000${template}`,
      )
      const cached = await options.cache?.get(cacheKey).catch(() => undefined)
      if (cached !== undefined) return cached

      const tasks = Object.fromEntries(
        await Promise.all(
          taskIds.map(async (taskId) => {
            const task = await options.getTaskById(taskId)
            if (!task) throw new Error(`Task template points to missing task ${taskId}`)
            return [`${TASK_REF_PREFIX}${taskId}`, task.content.data]
          }),
        ),
      )
      const rendered = await renderJinja(
        template,
        { tasks },
        { profile: 'task', signal: stopSignal },
      )
      if (typeof rendered !== 'string') throw new Error('Task template returned a non-string value')
      await options.cache?.set(cacheKey, rendered).catch(() => undefined)
      return rendered
    },
  }
}
