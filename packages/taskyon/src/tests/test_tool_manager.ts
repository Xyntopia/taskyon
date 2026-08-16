import { createTaskNode, forgeTaskChain } from '../core/createTasks'
import { findCallingToolReference, generateSecretId } from '../core/taskFunctionExecutor'
import { createToolManager, toolRevisionHash, type ToolStorageRecord } from '../core/toolManager'
import { createMapCrudWrapper } from '../utils/crudWrapper'
import { createAddNewTool } from '../tools/toolTools'

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

export function tool_managerRevisionIdentityIsCanonical() {
  const left = toolRevisionHash({
    publisherId: 'taskyon',
    name: 'example',
    description: 'Example',
    parameters: { type: 'object', properties: { b: { type: 'string' }, a: { type: 'number' } } },
    execution: { kind: 'sandboxed-code', runtime: 'javascript', source: '() => 1' },
  })
  const right = toolRevisionHash({
    execution: { source: '() => 1', runtime: 'javascript', kind: 'sandboxed-code' },
    parameters: { properties: { a: { type: 'number' }, b: { type: 'string' } }, type: 'object' },
    description: 'Example',
    name: 'example',
    publisherId: 'taskyon',
  })
  assert(left === right, 'Equivalent manifests must have the same revision')
  assert(left.startsWith('sha256:'), 'Tool revisions must identify the hash algorithm')
}

tool_managerRevisionIdentityIsCanonical.description =
  'Tool revisions use domain-separated canonical SHA-256 rather than task timestamps or function serialization.'

export async function tool_managerPinsImmutableRevisions() {
  const toolManager = createToolManager(createMapCrudWrapper<ToolStorageRecord>(new Map()))
  const first = await toolManager.installManifest({
    publisherId: 'taskyon',
    name: 'example',
    description: 'First',
    parameters: { type: 'object' },
    execution: { kind: 'sandboxed-code', runtime: 'javascript', source: '() => 1' },
  })
  const second = await toolManager.installManifest(
    {
      publisherId: 'taskyon',
      name: 'example',
      description: 'Second',
      parameters: { type: 'object' },
      execution: { kind: 'sandboxed-code', runtime: 'javascript', source: '() => 2' },
    },
    { approveReplacement: true },
  )

  assert(first.revision !== second.revision, 'Changed tools must create a new revision')
  assert(
    (await toolManager.resolveActiveRevision('example')) === second.revision,
    'Latest install is active',
  )
  assert(
    (await toolManager.getManifest(first.revision))?.description === 'First',
    'Replacing an active tool must not overwrite the pinned old revision',
  )
}

tool_managerPinsImmutableRevisions.description =
  'The CrudWrapper-backed ToolManager retains immutable revisions while updating the active name binding.'

export async function testAddNewToolRequiresExplicitReplacementApproval() {
  const toolManager = createToolManager(createMapCrudWrapper<ToolStorageRecord>(new Map()))
  const addNewTool = createAddNewTool(toolManager)
  const definition = {
    name: 'repairableTool',
    description: 'Initial implementation',
    parameters: { type: 'object' as const, properties: {} },
    code: 'async () => ({ version: 1 })',
  }
  await addNewTool.function?.(definition)
  let unapprovedError = ''
  try {
    await addNewTool.function?.({
      ...definition,
      description: 'Repaired implementation',
      code: 'async () => ({ version: 2 })',
    })
  } catch (error) {
    unapprovedError = error instanceof Error ? error.message : String(error)
  }
  assert(
    unapprovedError.includes('replacement approval is required'),
    `Expected an explicit replacement-approval error, got ${unapprovedError}`,
  )

  await addNewTool.function?.({
    ...definition,
    description: 'Repaired implementation',
    code: 'async () => ({ version: 2 })',
    approveReplacement: true,
  })
  const active = await toolManager.resolveTool(definition.name)
  assert(active.tool?.name === definition.name, 'Expected the repair to preserve the exact name')
  assert(
    active.tool?.description === 'Repaired implementation',
    'Expected approved replacement to become the active definition',
  )
}

testAddNewToolRequiresExplicitReplacementApproval.description =
  'Requires explicit approval at the addNewTool boundary and replaces the exact active tool name.'

export async function tool_managerExecutionUsesPinnedRevision() {
  const toolManager = createToolManager(createMapCrudWrapper<ToolStorageRecord>(new Map()))
  const pinned = await toolManager.installManifest({
    publisherId: 'taskyon',
    name: 'example',
    description: 'Pinned',
    parameters: { type: 'object' },
    execution: { kind: 'sandboxed-code', runtime: 'javascript', source: '() => 1' },
  })
  await toolManager.installManifest(
    {
      publisherId: 'taskyon',
      name: 'example',
      description: 'Active',
      parameters: { type: 'object' },
      execution: { kind: 'sandboxed-code', runtime: 'javascript', source: '() => 2' },
    },
    { approveReplacement: true },
  )
  const resolved = await toolManager.resolveTool('example', pinned.revision)

  assert(resolved.tool?.description === 'Pinned', 'Execution must use the task-pinned tool')
  assert(
    resolved.identity?.revision === pinned.revision,
    'Capabilities must use the pinned identity',
  )
}

tool_managerExecutionUsesPinnedRevision.description =
  'Execution, settings, secrets, and capabilities resolve the immutable tool revision pinned on the task.'

export async function tool_managerNameOnlyCallsUseActiveTool() {
  const toolManager = createToolManager(createMapCrudWrapper<ToolStorageRecord>(new Map()))
  const active = await toolManager.installManifest({
    publisherId: 'client',
    name: 'clientTool',
    description: 'Client-owned tool',
    parameters: { type: 'object' },
    execution: {
      kind: 'external-service',
      serviceId: 'client',
      implementationRevision: `sha256:${'a'.repeat(43)}`,
    },
  })
  const resolved = await toolManager.resolveTool('clientTool')

  assert(resolved.tool?.name === 'clientTool', 'Name-only client calls must use the active tool')
  assert(resolved.identity?.revision === active.revision, 'Active client identity must be returned')
}

tool_managerNameOnlyCallsUseActiveTool.description =
  'Name-only function calls remain compatible with tools whose implementation is owned by a Taskyon client.'

export async function tool_managerCoalescesConcurrentCatalogReads() {
  const records = new Map<string, ToolStorageRecord>()
  const storage = createMapCrudWrapper<ToolStorageRecord>(records)
  let listCount = 0
  let getCount = 0
  const toolManager = createToolManager({
    get: async (id) => {
      getCount += 1
      return await storage.get(id)
    },
    set: storage.set,
    list: async () => {
      listCount += 1
      await new Promise((resolve) => setTimeout(resolve, 10))
      return await storage.list()
    },
  })
  await toolManager.installManifest({
    publisherId: 'taskyon',
    name: 'catalogTool',
    description: 'Catalog tool',
    parameters: { type: 'object' },
    execution: { kind: 'sandboxed-code', runtime: 'javascript', source: '() => null' },
  })
  getCount = 0

  const catalogs = await Promise.all(
    Array.from({ length: 10 }, () => toolManager.listToolDefinitions(true)),
  )

  assert(listCount === 1, `Expected one shared storage read, received ${listCount}`)
  assert(getCount === 0, `Expected no follow-up record reads, received ${getCount}`)
  assert(
    catalogs.every((catalog) => catalog.catalogTool?.name === 'catalogTool'),
    'Every concurrent caller must receive the complete catalog',
  )
}

tool_managerCoalescesConcurrentCatalogReads.description =
  'Concurrent tool-catalog requests share one storage read instead of blocking task creation with duplicate database work.'

export async function tool_managerDoesNotRewriteUnchangedDefaultTools() {
  const records = new Map<string, ToolStorageRecord>()
  const storage = createMapCrudWrapper<ToolStorageRecord>(records)
  const tool = {
    name: 'defaultTool',
    description: 'Default tool',
    parameters: { type: 'object' },
    function: () => 'ready',
  } as const
  await createToolManager(storage).addDefaultTools([tool])

  let writes = 0
  const reloadedManager = createToolManager({
    get: storage.get,
    set: async (id, record) => {
      writes += 1
      await storage.set(id, record)
    },
    list: storage.list,
  })
  await reloadedManager.addDefaultTools([tool])
  const resolved = await reloadedManager.resolveTool(tool.name)

  assert(writes === 0, `Expected no storage writes for an unchanged tool, received ${writes}`)
  assert(
    resolved.tool?.function === tool.function,
    'Reloading an unchanged native tool must restore its runtime implementation',
  )
}

tool_managerDoesNotRewriteUnchangedDefaultTools.description =
  'Reloading Taskyon restores unchanged default tools in memory without rewriting their persisted manifests and active revisions.'

export async function tool_managerBatchesDefaultToolPersistence() {
  const records = new Map<string, ToolStorageRecord>()
  const storage = createMapCrudWrapper<ToolStorageRecord>(records)
  let individualWrites = 0
  let batchWrites = 0
  const toolManager = createToolManager({
    get: storage.get,
    set: async (id, record) => {
      individualWrites += 1
      await storage.set(id, record)
    },
    setMany: async (rows) => {
      batchWrites += 1
      await Promise.all(rows.map(({ id, data }) => storage.set(id, data)))
    },
    list: storage.list,
  })

  await toolManager.addDefaultTools([
    {
      name: 'firstDefaultTool',
      description: 'First default tool',
      parameters: { type: 'object' },
      function: () => 'first',
    },
    {
      name: 'secondDefaultTool',
      description: 'Second default tool',
      parameters: { type: 'object' },
      function: () => 'second',
    },
  ])

  assert(batchWrites === 1, `Expected one batch write, received ${batchWrites}`)
  assert(individualWrites === 0, `Expected no individual writes, received ${individualWrites}`)
  assert(records.size === 4, `Expected two manifests and two active revisions, got ${records.size}`)
}

tool_managerBatchesDefaultToolPersistence.description =
  'Cold-start default tool registration persists manifests and active revisions in one storage batch.'

export async function tool_managerNameOnlyCallersResolveSecretIdentity() {
  const toolManager = createToolManager(createMapCrudWrapper<ToolStorageRecord>(new Map()))
  const active = await toolManager.installManifest({
    publisherId: 'client',
    name: 'clientTool',
    description: 'Client-owned tool',
    parameters: { type: 'object' },
    execution: {
      kind: 'external-service',
      serviceId: 'client',
      implementationRevision: `sha256:${'a'.repeat(43)}`,
    },
  })
  const [caller, delegated] = await forgeTaskChain([
    [
      {
        role: 'function',
        content: { type: 'functioncall', data: { name: 'clientTool', arguments: {} } },
      },
      {
        role: 'function',
        content: { type: 'functioncall', data: { name: 'ensureOauthLogin', arguments: {} } },
      },
    ],
  ])
  assert(caller && delegated, 'Expected a caller and delegated OAuth task')
  const callerReference = findCallingToolReference([caller, delegated], 'ensureOauthLogin')
  assert(callerReference, 'Name-only caller reference must be retained')
  const nameOnly = await toolManager.resolveTool(callerReference.name, callerReference.revision)
  const pinned = await toolManager.resolveTool('clientTool', active.revision)
  const nameOnlyId = nameOnly.tool
    ? await generateSecretId(nameOnly.identity?.revision, nameOnly.tool)
    : null
  const pinnedId = pinned.tool
    ? await generateSecretId(pinned.identity?.revision, pinned.tool)
    : null

  assert(nameOnlyId !== null, 'Name-only callers must resolve the active tool identity')
  assert(nameOnlyId === pinnedId, 'Name-only and explicitly pinned active callers share secrets')
}

tool_managerNameOnlyCallersResolveSecretIdentity.description =
  'OAuth and other delegated tools resolve secret ownership for both name-only and pinned callers.'

export async function tool_managerCallerControlsOptionalRevision() {
  const revision = `sha256:${'b'.repeat(43)}` as const
  const [pinned] = await forgeTaskChain([
    [
      {
        role: 'assistant',
        content: {
          type: 'functioncall',
          data: { name: 'clientTool', arguments: {}, toolRevision: revision },
        },
      },
    ],
  ])
  const [nameOnly] = await forgeTaskChain([
    [
      {
        role: 'assistant',
        content: { type: 'functioncall', data: { name: 'clientTool', arguments: {} } },
      },
    ],
  ])

  assert(
    pinned?.content.type === 'functioncall' && pinned.content.data.toolRevision === revision,
    'forgeTaskChain must preserve the revision selected by the caller',
  )
  assert(
    nameOnly?.content.type === 'functioncall' && !nameOnly.content.data.toolRevision,
    'forgeTaskChain must preserve a caller-selected name-only tool call',
  )
  assert(pinned.id !== nameOnly.id, 'The optional revision must remain part of the task hash')
  await createTaskNode(pinned)
  await createTaskNode(nameOnly)
}

tool_managerCallerControlsOptionalRevision.description =
  'Callers may pin a tool revision or intentionally create a name-only call before deterministic hashing.'
