import {
  TASK_TEMPLATE_CACHE_MAX_BYTES,
  createPersistentTaskTemplateCache,
  createTaskTemplateRenderer,
} from '../core/taskTemplateRenderer'
import type { TaskNode } from '../types/taskNode'
import { createMapCrudWrapper } from '../utils/crudWrapper'

const assert = (condition: unknown, message: string) => {
  if (!condition) throw new Error(message)
}

export const testTaskTemplateRendererUsesSandboxedJinja = async () => {
  const sourceTask: TaskNode = {
    id: 'gitlab-result',
    role: 'assistant',
    content: {
      type: 'toolresult',
      data: {
        issues: [
          { iid: 2, title: 'Second' },
          { iid: 1, title: 'First' },
        ],
      },
    },
  }
  const renderer = createTaskTemplateRenderer({
    getTaskById: (taskId) => Promise.resolve(taskId === sourceTask.id ? sourceTask : null),
  })

  const rendered = await renderer.render(
    '{% for issue in tasks["_t:gitlab-result"].issues %}{{ issue.iid }}: {{ issue.title }}\n{% endfor %}',
  )
  const literalExample = '{% for item in values %}{{ item }}{% endfor %}'

  assert(rendered === '2: Second\n1: First\n', `Unexpected Jinja output: ${rendered}`)
  assert(
    (await renderer.render(literalExample)) === literalExample,
    'Expected Jinja examples without Taskyon references to remain literal',
  )
  return { success: true }
}

export const testPersistentTemplateCacheSurvivesRecreationAndEvictsLru = async () => {
  const storage = createMapCrudWrapper(
    new Map<string | number, { accessedAt: number; value: string }>(),
  )
  let now = 1
  const createCache = () =>
    createPersistentTaskTemplateCache({
      storage,
      maxBytes: 420,
      now: () => now++,
    })

  const firstCache = createCache()
  await firstCache.set('first', 'a'.repeat(80))
  await firstCache.set('second', 'b'.repeat(80))
  await firstCache.get('first')

  const recreatedCache = createCache()
  assert((await recreatedCache.get('first')) === 'a'.repeat(80), 'Expected a persistent cache hit')
  await recreatedCache.set('third', 'c'.repeat(180))

  assert(await recreatedCache.get('first'), 'Expected the recently used entry to remain cached')
  assert((await recreatedCache.get('second')) === undefined, 'Expected the LRU entry to be evicted')
  return { success: true }
}

export const testTaskTemplateCacheUsesTenMibibyteBudget = () => {
  assert(
    TASK_TEMPLATE_CACHE_MAX_BYTES === 10 * 1024 * 1024,
    `Expected a 10 MiB template cache, got ${TASK_TEMPLATE_CACHE_MAX_BYTES}`,
  )
  return { success: true }
}

testTaskTemplateRendererUsesSandboxedJinja.description =
  'Renders task-result projections with Jinja inside the isolated JavaScript sandbox.'
testPersistentTemplateCacheSurvivesRecreationAndEvictsLru.description =
  'Persists rendered templates through the shared storage CRUD and evicts by serialized LRU size.'
testTaskTemplateCacheUsesTenMibibyteBudget.description =
  'Caps the local rendered-template cache at 10 MiB.'
