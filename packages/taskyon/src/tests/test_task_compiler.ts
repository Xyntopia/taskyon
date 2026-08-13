import { createMapCrudWrapper } from '../utils/crudWrapper'
import { createTool } from '../types/toolApi'
import { createToolManager, type ToolStorageRecord } from '../core/toolManager'
import {
  createInvocationRevisionResolver,
  createToolSettingsManager,
  type ToolSettingsRecord,
} from '../core/toolSettings'
import { compileTaskChain, createTaskCompiler } from '../core/taskCompiler'
import { createTaskNode, ensureValidTaskId } from '../core/createTasks'

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

export async function testTaskCompilerPinsOpaqueInvocationRevisions() {
  const toolManager = createToolManager(createMapCrudWrapper<ToolStorageRecord>(new Map()))
  const settingsManager = createToolSettingsManager(
    createMapCrudWrapper<ToolSettingsRecord>(new Map()),
  )
  await toolManager.installTool(
    createTool({
      name: 'configuredTool',
      description: 'Configured tool.',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: { explicit: { type: 'boolean' }, model: { type: 'string' } },
      },
      function: () => undefined,
    }),
    { approveReplacement: true },
  )
  const resolveInvocationRevisions = createInvocationRevisionResolver({
    resolveTool: toolManager.resolveTool,
    getToolSettings: () => ({ model: 'private-runtime-setting' }),
    settingsManager,
  })

  const [compiled] = await compileTaskChain(
    [
      {
        role: 'function',
        content: {
          type: 'functioncall',
          data: { name: 'configuredTool', arguments: { explicit: true } },
        },
      },
    ],
    {
      lineage: [],
      parentID: 'parent-task',
      toolManager,
      resolveInvocationRevisions,
    },
  )

  assert(compiled !== undefined, 'Expected one compiled task')
  assert(compiled.content.type === 'functioncall', 'Expected a function call')
  assert(compiled.parentID === 'parent-task', 'Expected the compiler to link the parent')
  assert(compiled.content.data.toolRevision !== undefined, 'Expected a tool revision')
  assert(compiled.content.data.settingsRevision !== undefined, 'Expected a settings revision')
  assert(
    compiled.content.data.arguments.model === undefined,
    'Persisted calls must not expose settings values',
  )
  assert(compiled.content.data.arguments.explicit === true, 'Explicit arguments must be preserved')
  assert((await ensureValidTaskId(compiled)).id === compiled.id, 'Compiled id must be verifiable')
}

testTaskCompilerPinsOpaqueInvocationRevisions.description =
  'Compiles linked, verifiable tasks while persisting opaque per-tool revisions instead of settings values.'

export async function testTaskCompilerRejectsAnIdOnADraft() {
  const toolManager = createToolManager(createMapCrudWrapper<ToolStorageRecord>(new Map()))
  let error: unknown
  try {
    await compileTaskChain(
      [
        {
          id: 'already-hashed',
          role: 'assistant',
          content: { type: 'message', data: 'not a draft' },
        },
      ],
      {
        lineage: [],
        toolManager,
        resolveInvocationRevisions: () => Promise.resolve(null),
      },
    )
  } catch (caught) {
    error = caught
  }
  assert(error instanceof Error, 'Expected a supplied id to be rejected')
}

testTaskCompilerRejectsAnIdOnADraft.description =
  'Keeps compilation of unhashed drafts separate from verification of completed task nodes.'

export async function testTaskCompilerRejectsAnUnresolvedToolCall() {
  const toolManager = createToolManager(createMapCrudWrapper<ToolStorageRecord>(new Map()))
  let error: unknown
  try {
    await compileTaskChain(
      [
        {
          role: 'function',
          content: {
            type: 'functioncall',
            data: { name: 'missingTool', arguments: {} },
          },
        },
      ],
      {
        lineage: [],
        toolManager,
        resolveInvocationRevisions: () => Promise.resolve(null),
      },
    )
  } catch (caught) {
    error = caught
  }

  assert(error instanceof Error, 'Expected an unresolved tool call to fail compilation')
  assert(
    error.message.includes('missingTool'),
    'Expected the compilation error to identify the unresolved tool',
  )
}

testTaskCompilerRejectsAnUnresolvedToolCall.description =
  'Rejects function calls that cannot be pinned to immutable invocation revisions before hashing.'

export async function testTaskCompilerVerifiesCompletedChainsWithoutRewritingThem() {
  const toolManager = createToolManager(createMapCrudWrapper<ToolStorageRecord>(new Map()))
  const completed = await createTaskNode({
    role: 'assistant',
    content: { type: 'message', data: 'already compiled' },
  })
  const compiler = createTaskCompiler({
    getTaskLineage: () => Promise.resolve([]),
    toolManager,
    resolveInvocationRevisions: () => Promise.resolve(null),
  })

  const [verified] = await compiler.compileOrVerifyChain([completed])

  assert(verified, 'Expected one verified task')
  assert(verified.id === completed.id, 'Verification must preserve the caller-supplied task id')
  assert(
    verified.created_at === completed.created_at,
    'Verification must not regenerate completed task metadata',
  )
}

testTaskCompilerVerifiesCompletedChainsWithoutRewritingThem.description =
  'Verifies completed task chains without recompiling or changing their content-derived identity.'

export async function testTaskCompilerRejectsMixedCompletedAndDraftChains() {
  const toolManager = createToolManager(createMapCrudWrapper<ToolStorageRecord>(new Map()))
  const completed = await createTaskNode({
    role: 'assistant',
    content: { type: 'message', data: 'completed' },
  })
  const compiler = createTaskCompiler({
    getTaskLineage: () => Promise.resolve([]),
    toolManager,
    resolveInvocationRevisions: () => Promise.resolve(null),
  })
  let error: unknown

  try {
    await compiler.compileOrVerifyChain([
      completed,
      { role: 'assistant', content: { type: 'message', data: 'draft' } },
    ])
  } catch (caught) {
    error = caught
  }

  assert(error instanceof Error, 'Expected a mixed chain to be rejected')
}

testTaskCompilerRejectsMixedCompletedAndDraftChains.description =
  'Rejects chains that mix caller-verified tasks with drafts requiring core compilation.'

export async function testTaskCompilerLoadsLineageFromNearestLink() {
  const toolManager = createToolManager(createMapCrudWrapper<ToolStorageRecord>(new Map()))
  const requestedLineages: string[] = []
  const compiler = createTaskCompiler({
    getTaskLineage: (id) => {
      requestedLineages.push(id)
      return Promise.resolve([])
    },
    toolManager,
    resolveInvocationRevisions: () => Promise.resolve(null),
  })

  await compiler.compileDraftChain(
    [{ role: 'assistant', content: { type: 'message', data: 'linked draft' } }],
    { parentID: 'parent-task', priorID: 'prior-task' },
  )

  assert(
    requestedLineages.join(',') === 'prior-task',
    'Expected compilation to load lineage from priorID before parentID',
  )
}

testTaskCompilerLoadsLineageFromNearestLink.description =
  'Loads scoped compilation context from the nearest prior task, falling back to the parent.'

export async function testTaskCompilerUsesDraftRootLinksWhenNoLinksAreSupplied() {
  const toolManager = createToolManager(createMapCrudWrapper<ToolStorageRecord>(new Map()))
  const requestedLineages: string[] = []
  await toolManager.installTool(
    createTool({
      name: 'followingTool',
      description: 'Following tool.',
      parameters: { type: 'object', additionalProperties: false, properties: {} },
      function: () => undefined,
    }),
    { approveReplacement: true },
  )
  const settingsManager = createToolSettingsManager(
    createMapCrudWrapper<ToolSettingsRecord>(new Map()),
  )
  const compiler = createTaskCompiler({
    getTaskLineage: (id) => {
      requestedLineages.push(id)
      return Promise.resolve([])
    },
    toolManager,
    resolveInvocationRevisions: createInvocationRevisionResolver({
      resolveTool: toolManager.resolveTool,
      getToolSettings: () => ({}),
      settingsManager,
    }),
  })

  const [compiled, following] = await compiler.compileOrVerifyChain([
    {
      role: 'assistant',
      priorID: 'conversation-leaf',
      content: { type: 'message', data: 'continued draft' },
    },
    {
      role: 'function',
      content: {
        type: 'functioncall',
        data: { name: 'followingTool', arguments: {} },
      },
    },
  ])

  assert(compiled, 'Expected one compiled task')
  assert(following, 'Expected the following task to be compiled')
  assert(compiled.priorID === 'conversation-leaf', 'Expected the root priorID to be preserved')
  assert(following.priorID === compiled.id, 'Expected the following task to link to the root')
  assert(
    requestedLineages.join(',') === 'conversation-leaf',
    'Expected compilation to load the draft root lineage',
  )
}

testTaskCompilerUsesDraftRootLinksWhenNoLinksAreSupplied.description =
  'Uses a draft chain root link to continue and compile against an existing conversation lineage.'
