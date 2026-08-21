import { forgeTaskChain } from '../core/createTasks'
import {
  createInvocationToolResolver,
  findCallingToolReference,
  prepareInvocationToolCall,
} from '../core/taskFunctionExecutor'
import { scopedToolIdentity } from '../core/scopedTools'
import type { partialTaskDraft } from '../types/taskNode'
import type { TaskNode } from '../types/taskNode'
import { resolvePreviousSiblingResultTask } from '../core/taskChainSelection'
import {
  compileTaskyonFunctionArguments,
  createTaskVariablePresentationService,
  materializeTaskyonFunctionArguments,
} from '../core/taskVariables'

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

export async function testTaskFunctionExecutorResolvesRevisionPinnedScopedCaller() {
  const definitionDraft = {
    role: 'assistant',
    content: {
      type: 'tooldefinition',
      data: {
        name: 'scopedCaller',
        description: 'A tree-local caller.',
        parameters: { type: 'object', additionalProperties: false },
        code: 'return null',
      },
    },
  } satisfies partialTaskDraft
  const [identitySource] = await forgeTaskChain([[definitionDraft]])
  assert(identitySource, 'Expected a scoped tool-definition task')
  const revision = scopedToolIdentity(identitySource, 'scopedCaller').revision
  const taskChain = await forgeTaskChain([
    [
      definitionDraft,
      {
        role: 'function',
        content: {
          type: 'functioncall',
          data: { name: 'scopedCaller', arguments: {}, toolRevision: revision },
        },
      },
      {
        role: 'function',
        content: { type: 'functioncall', data: { name: 'delegatedTool', arguments: {} } },
      },
    ],
  ])
  const caller = taskChain[1]
  const delegated = taskChain[2]
  assert(caller && delegated, 'Expected a scoped caller and delegated function call')
  assert(delegated.content.type === 'functioncall', 'Expected a delegated function call')
  const tasks = new Map(taskChain.map((task) => [task.id, task]))
  let registryLookups = 0
  const resolveInvocationTool = createInvocationToolResolver({
    getExecutionTask: (id) => Promise.resolve(tasks.get(id) ?? null),
    getTaskLineage: () => Promise.resolve(taskChain),
    resolveRegisteredTool: () => {
      registryLookups += 1
      return Promise.resolve({})
    },
  })

  const callerReference = findCallingToolReference(taskChain, delegated.content.data.name)
  assert(callerReference, 'Expected the delegated call to retain its caller reference')
  assert(callerReference.taskId === caller.id, 'Caller lookup must retain the caller task id')
  assert(callerReference.revision === revision, 'Caller lookup must retain the scoped revision')
  const resolved = await resolveInvocationTool(callerReference.name, {
    taskId: callerReference.taskId,
    toolRevision: revision,
  })

  assert(resolved.source === 'task-tree', 'Pinned scoped callers must resolve from their task tree')
  assert(resolved.tool?.code === 'return null', 'The scoped caller implementation must be returned')
  assert(registryLookups === 0, 'Scoped caller resolution must not consult the central registry')
}

testTaskFunctionExecutorResolvesRevisionPinnedScopedCaller.description =
  'Revision-pinned scoped callers retain their task identity and resolve through the same task-tree lookup used for execution.'

export async function testTaskFunctionExecutorAppliesOnlyPinnedSettings() {
  const toolRevision = `sha256:${'c'.repeat(43)}` as const
  const settingsRevision = `sha256:${'d'.repeat(43)}` as const
  let requestedSettingsRevision: string | undefined
  const prepared = await prepareInvocationToolCall(
    {
      type: 'functionCall',
      requestId: 'pinned-settings',
      functionName: 'configuredTool',
      toolRevision,
      settingsRevision,
      arguments: { explicit: true },
    },
    {
      resolveInvocationTool: () =>
        Promise.resolve({
          source: 'registry' as const,
          identity: { publisherId: 'test', name: 'configuredTool', revision: toolRevision },
          tool: {
            name: 'configuredTool',
            description: 'Configured tool.',
            parameters: {
              type: 'object',
              additionalProperties: false,
              properties: {
                schemaDefault: { type: 'string', default: 'from-schema' },
                setting: { type: 'string' },
                explicit: { type: 'boolean' },
              },
            },
            function: () => undefined,
          },
        }),
      getTaskById: () => Promise.resolve(null),
      resolveToolSettings: (_name, _toolRevision, revision) => {
        requestedSettingsRevision = revision
        return Promise.resolve({ setting: 'from-pinned-snapshot' })
      },
    },
  )

  assert(requestedSettingsRevision === settingsRevision, 'Expected the exact settings revision')
  assert(
    prepared.arguments.schemaDefault === 'from-schema',
    'Expected schema defaults at execution',
  )
  assert(
    prepared.arguments.setting === 'from-pinned-snapshot',
    'Expected settings from the pinned snapshot',
  )
  assert(prepared.arguments.explicit === true, 'Expected explicit call arguments to win')
}

testTaskFunctionExecutorAppliesOnlyPinnedSettings.description =
  'Applies schema defaults and the exact pinned settings snapshot only when executing a call.'

export async function testTaskFunctionExecutorMaterializesPreviousResultPaths() {
  const toolRevision = `sha256:${'e'.repeat(43)}` as const
  const previousResult = {
    id: 'previous-result',
    role: 'function',
    content: {
      type: 'toolresult',
      data: {
        matches: [{ name: 'constructionDecking' }],
        metadata: { total: 1 },
      },
    },
  } satisfies partialTaskDraft & { id: string }
  const compiled = compileTaskyonFunctionArguments(
    { $use: { matchName: '$previousResult.matches[0].name' } },
    createTaskVariablePresentationService(),
  )
  const compiledUse = compiled.$use as Record<string, unknown>
  assert(
    compiledUse.matchName === '$previousResult.matches[0].name',
    'Expected compilation to preserve relative previous-result paths',
  )
  const prepared = await prepareInvocationToolCall(
    {
      type: 'functionCall',
      requestId: 'previous-result-paths',
      taskId: 'current-entry-node',
      functionName: 'consumeSearchResult',
      toolRevision,
      arguments: {
        $use: {
          matchName: '$previousResult.matches[0].name',
          total: '$previousResult.metadata.total',
        },
      },
    },
    {
      resolveInvocationTool: () =>
        Promise.resolve({
          source: 'registry' as const,
          identity: { publisherId: 'test', name: 'consumeSearchResult', revision: toolRevision },
          tool: {
            name: 'consumeSearchResult',
            description: 'Consumes a previous search result.',
            parameters: {
              type: 'object',
              additionalProperties: false,
              properties: {
                matchName: { type: 'string' },
                total: { type: 'integer' },
              },
            },
            function: () => undefined,
          },
        }),
      getTaskById: () => Promise.resolve(null),
      resolvePreviousResultTask: () => Promise.resolve(previousResult),
      resolveToolSettings: () => Promise.resolve(undefined),
    },
  )

  assert(
    prepared.arguments.matchName === 'constructionDecking',
    'Expected an indexed previous-result path to be materialized',
  )
  assert(
    prepared.arguments.total === 1,
    'Expected a dotted previous-result path to be materialized',
  )

  let missingPathError = ''
  try {
    await materializeTaskyonFunctionArguments(
      { $use: { value: '$previousResult.metadata.missing' } },
      {
        surface: 'execution',
        getTaskById: () => Promise.resolve(null),
        resolveRelativeTaskRef: () => Promise.resolve(previousResult),
      },
    )
  } catch (error) {
    missingPathError = error instanceof Error ? error.message : String(error)
  }
  assert(
    missingPathError.includes('missing result path'),
    `Expected missing previous-result paths to fail clearly, got ${missingPathError}`,
  )
}

testTaskFunctionExecutorMaterializesPreviousResultPaths.description =
  'Materializes dotted and indexed $previousResult references from the terminal preceding branch result.'

export async function testPreviousResultResolvesNestedToolResultLeaf() {
  const tasks = new Map<string, TaskNode>([
    [
      'current',
      {
        id: 'current',
        priorID: 'previous',
        role: 'function',
        content: { type: 'functioncall', data: { name: 'consumeSearchResult', arguments: {} } },
      },
    ],
    [
      'previous',
      {
        id: 'previous',
        role: 'function',
        content: { type: 'functioncall', data: { name: 'entryNodeToolSearch', arguments: {} } },
      },
    ],
    [
      'search-call',
      {
        id: 'search-call',
        parentID: 'previous',
        role: 'function',
        content: { type: 'functioncall', data: { name: 'toolSearcher', arguments: {} } },
      },
    ],
    [
      'search-result',
      {
        id: 'search-result',
        parentID: 'search-call',
        role: 'system',
        content: {
          type: 'toolresult',
          data: { 'Here are the matching tools': [{ name: 'exploration', description: 'Explore files.' }] },
        },
      },
    ],
  ])

  const resolved = await resolvePreviousSiblingResultTask('current', {
    getTask: (id) => Promise.resolve(tasks.get(id) ?? null),
    searchAllDirectChildren: (id) =>
      Promise.resolve(
        new Set(
          [...tasks.values()]
            .filter((task) => task.parentID === id && !task.priorID)
            .map((task) => task.id),
        ),
      ),
    findSiblingLeafTasks: (id) => Promise.resolve([id]),
  })

  assert(
    resolved?.id === 'search-result',
    `Expected nested tool result leaf, got ${resolved?.id ?? 'none'}`,
  )
}

testPreviousResultResolvesNestedToolResultLeaf.description =
  'Resolves $previousResult to a visible terminal result below a preceding tool-call branch.'

export async function testPreviousResultRejectsAmbiguousSiblingBranches() {
  const task = (id: string, priorID?: string): TaskNode => ({
    id,
    ...(priorID ? { priorID } : {}),
    role: 'function',
    content: { type: 'functioncall', data: { name: 'tool', arguments: {} } },
  })
  const tasks = new Map([
    ['current', task('current', 'previous')],
    ['previous', task('previous')],
    ['branch-a', task('branch-a')],
    ['branch-b', task('branch-b')],
    ['leaf-a', task('leaf-a')],
    ['leaf-b', task('leaf-b')],
  ])
  let errorMessage = ''
  try {
    await resolvePreviousSiblingResultTask('current', {
      getTask: (id) => Promise.resolve(tasks.get(id) ?? null),
      searchAllDirectChildren: (id) =>
        Promise.resolve(id === 'previous' ? new Set(['branch-a', 'branch-b']) : new Set()),
      findSiblingLeafTasks: (id) =>
        Promise.resolve(id === 'branch-a' ? ['leaf-a'] : id === 'branch-b' ? ['leaf-b'] : []),
    })
  } catch (error) {
    errorMessage = error instanceof Error ? error.message : String(error)
  }
  assert(
    errorMessage.includes('is ambiguous'),
    `Expected multiple preceding result leaves to be rejected, got ${errorMessage}`,
  )
}

testPreviousResultRejectsAmbiguousSiblingBranches.description =
  'Rejects $previousResult when the previous sibling branch has multiple terminal leaves.'
