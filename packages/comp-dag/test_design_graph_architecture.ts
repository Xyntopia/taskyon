import { canonicalHash, type Hash } from './caching.ts'
import {
  createGraphRevision,
  createInvocationDefinition,
  createInvocationRun,
  createProjectExtension,
  createProjectRevision,
  deriveInvocationCategory,
} from './designGraphModel.ts'
import {
  createDesignGraphRepository,
  createStorageDesignGraphObjectStore,
} from './designGraphRepository.ts'
import { createProjectDraftStore } from './projectDraft.ts'
import { importDesignGraphSnapshot, projectDesignGraphSnapshot } from './dagGitProjection.ts'
import { createDagModuleArtifact, createDagModuleLock } from './dagModule.ts'
import { SELF_HASH_PLACEHOLDER, hashFilePart } from './dagNodeIdentity.ts'
import { saveStoredGraphNodeSource } from './dagNodeLoader.ts'
import {
  replaceDagNodeRecordModuleSource,
  replaceDagNodeRecordPackageRange,
} from './dagNodeRecordGraph.ts'
import { createDerivedExpression, evaluateDerivedExpression } from './derivedExpression.ts'
import {
  executeInvocation,
  iterateInvocationCandidates,
  type StagedArtifactWriter,
} from './invocationExecution.ts'
import { iterateInvocationRowRange } from './storageInvocationRows.ts'

const assert: (condition: unknown, message: string) => asserts condition = (condition, message) => {
  if (!condition) throw new Error(message)
}

const createMemoryStore = () => {
  const values = new Map<string, string>()
  let bulkReads = 0
  let bulkWrites = 0
  return {
    values,
    counts: () => ({ bulkReads, bulkWrites }),
    store: {
      readText: (path: string) => {
        const value = values.get(path)
        if (value === undefined) throw new Error(`Design graph object not found: ${path}`)
        return Promise.resolve(value)
      },
      writeText: (path: string, value: string) => {
        values.set(path, value)
        return Promise.resolve()
      },
      readManyText: (paths: readonly string[]) => {
        bulkReads += 1
        return Promise.resolve(
          new Map(paths.map((path) => [path, values.get(path) ?? null] as const)),
        )
      },
      writeManyText: (files: readonly { path: string; content: string }[]) => {
        bulkWrites += 1
        for (const file of files) values.set(file.path, file.content)
        return Promise.resolve()
      },
      writeTextIfUnchanged: (path: string, expectedContentHash: string | null, value: string) => {
        const current = values.get(path) ?? null
        const currentContentHash = current === null ? null : canonicalHash(current)
        if (currentContentHash !== expectedContentHash) {
          return Promise.resolve({ written: false, currentContentHash })
        }
        values.set(path, value)
        return Promise.resolve({ written: true, currentContentHash: canonicalHash(value) })
      },
      list: (directory: string) => {
        const prefix = `${directory}/`
        return Promise.resolve(
          [...values.keys()]
            .filter((path) => path.startsWith(prefix))
            .map((path) => path.slice(prefix.length))
            .sort(),
        )
      },
    },
  }
}

export const testDesignGraphImportBatchesImmutableObjects = async () => {
  const memory = createMemoryStore()
  const node = await saveStoredGraphNodeSource(`export default {
  formatVersion: 2,
  id: '${SELF_HASH_PLACEHOLDER}',
  localName: 'BatchImportNode',
  label: 'Batch import node',
  version: 1,
  localParamsSchema: {},
  outputSchema: {},
  inputs: {},
  run: () => 1,
}`)
  const revision = createGraphRevision({ parents: [], nodes: { main: node.hash } })
  await importDesignGraphSnapshot({
    store: memory.store,
    files: [
      { path: `nodes/${hashFilePart(node.hash)}.ts`, content: node.file.source },
      {
        path: `graph-revisions/${hashFilePart(revision.id)}.json`,
        content: `${JSON.stringify(revision)}\n`,
      },
      {
        path: 'refs/graph/main.json',
        content: `${JSON.stringify({ schemaVersion: 2, revisionId: revision.id })}\n`,
      },
    ],
  })

  const counts = memory.counts()
  assert(counts.bulkReads === 1, `Expected one immutable-object bulk read, got ${counts.bulkReads}`)
  assert(
    counts.bulkWrites === 1,
    `Expected one immutable-object bulk write, got ${counts.bulkWrites}`,
  )
}

testDesignGraphImportBatchesImmutableObjects.description =
  'Imports a stored graph closure with one bulk immutable-object read and write before advancing refs.'

export const testStorageDesignGraphCacheDoesNotHideRefChanges = async () => {
  const values = new Map<string, unknown>([['refs/graph/main.json', 'first']])
  const store = createStorageDesignGraphObjectStore({
    get: ({ id }) => {
      const value = values.get(id) ?? null
      return Promise.resolve({
        value,
        contentHash: value === null ? null : canonicalHash(value),
      })
    },
    set: ({ id, value }) => {
      values.set(id, value)
      return Promise.resolve()
    },
    setIfUnchanged: ({ id, expectedContentHash, value }) => {
      const current = values.get(id) ?? null
      const currentContentHash = current === null ? null : canonicalHash(current)
      if (currentContentHash !== expectedContentHash) {
        return Promise.resolve({ written: false, currentContentHash })
      }
      values.set(id, value)
      return Promise.resolve({ written: true, currentContentHash: canonicalHash(value) })
    },
    list: () => Promise.resolve({ rows: [...values].map(([id, data]) => ({ id, data })) }),
  })

  assert((await store.readText('refs/graph/main.json')) === 'first', 'Expected initial ref.')
  values.set('refs/graph/main.json', 'second')
  assert(
    (await store.readText('refs/graph/main.json')) === 'second',
    'Mutable refs must be re-read after another repository instance advances them.',
  )
}

testStorageDesignGraphCacheDoesNotHideRefChanges.description =
  'Caches immutable graph objects without hiding ref advances made through another repository instance.'

export const testUnifiedDesignGraphIdentityAndCategories = () => {
  const nodeId = canonicalHash('unified-root')
  const design = createInvocationDefinition({
    rootNodeId: nodeId,
    variables: { capacity: { kind: 'constant', value: 10 } },
    objectives: [],
    constraints: [],
    policy: { accuracy: 'auto' },
    reducerOverrides: {},
  })
  const exploration = createInvocationDefinition({
    rootNodeId: nodeId,
    variables: { capacity: { kind: 'grid', values: [10, 20] } },
    objectives: [],
    constraints: [],
    policy: { accuracy: 'auto' },
    reducerOverrides: {},
  })
  const optimization = createInvocationDefinition({
    rootNodeId: nodeId,
    variables: { capacity: { kind: 'grid', values: [10, 20] } },
    objectives: [{ direction: 'max', target: { path: 'profit', op: 'identity' } }],
    constraints: [],
    policy: { accuracy: 'auto' },
    reducerOverrides: {},
  })

  assert(deriveInvocationCategory(design) === 'design', 'Expected constant invocation to be design')
  assert(
    deriveInvocationCategory(exploration) === 'exploration',
    'Expected variable invocation to be exploration',
  )
  assert(
    deriveInvocationCategory(optimization) === 'optimization',
    'Expected objective invocation to be optimization',
  )
  assert(!('name' in design), 'Invocation identity must not contain a friendly name')
  return { design: design.id, exploration: exploration.id, optimization: optimization.id }
}

testUnifiedDesignGraphIdentityAndCategories.description =
  'Uses one immutable invocation shape and derives design, exploration, and optimization labels.'

export const testUnifiedProjectRepositoryKeepsRefsAndRunsSeparate = async () => {
  const memory = createMemoryStore()
  const repository = createDesignGraphRepository(memory.store)
  const nodeId = canonicalHash('project-root')
  const graph = createGraphRevision({ parents: [], nodes: { root: nodeId } })
  const invocation = createInvocationDefinition({
    rootNodeId: nodeId,
    variables: {},
    objectives: [],
    constraints: [],
    policy: { accuracy: 'auto' },
    reducerOverrides: {},
  })
  const extension = createProjectExtension({
    namespace: 'taskyon.workspace/main',
    value: { layout: 'default' },
  })
  const project = createProjectRevision({
    parents: [],
    displayName: 'Unified project',
    invocations: { baseline: invocation.id },
    extensions: { 'taskyon.workspace/main': extension.id },
  })
  const run = createInvocationRun({
    invocationId: invocation.id,
    resolvedPolicy: {
      engine: { id: 'taskyon', version: 1 },
      accuracy: 'exact',
      strategies: {},
    },
    status: 'completed',
    startedAtMs: 1,
    completedAtMs: 2,
    artifacts: { rows: canonicalHash('rows') },
    provenance: {},
  })

  await repository.putGraphRevision(graph)
  await repository.putInvocation(invocation)
  await repository.putExtension(extension)
  await repository.putProjectRevision(project)
  await repository.putRun(run)
  await repository.advanceGraphRef({ name: 'graph/main', revisionId: graph.id, expected: null })
  await repository.advanceProjectRef({
    name: 'projects/unified',
    revisionId: project.id,
    expected: null,
  })

  assert(
    (await repository.getProjectRevision(project.id)).displayName === 'Unified project',
    'Expected project revision',
  )
  assert(
    (await repository.getProjectRef('projects/unified'))?.revisionId === project.id,
    'Expected stable project ref',
  )
  assert(
    (await repository.listRuns(invocation.id))[0]?.id === run.id,
    'Expected run lookup by full invocation hash',
  )
  assert(
    [...memory.values.keys()].every((path) => !path.includes('metadata/projects')),
    'Expected no parallel mutable project metadata',
  )
  return [...memory.values.keys()].sort()
}

testUnifiedProjectRepositoryKeepsRefsAndRunsSeparate.description =
  'Stores graph, project, invocation, extension, and run records in one repository with typed refs.'

export const testNodeGitProjectionIncludesLockedModuleClosure = async () => {
  const memory = createMemoryStore()
  const repository = createDesignGraphRepository(memory.store)
  const module = createDagModuleArtifact({
    mediaType: 'text/typescript',
    source: 'export const value = 1',
  })
  const lock = createDagModuleLock({
    imports: { $node: { './value.ts': { kind: 'module', id: module.id } } },
  })
  const node = await saveStoredGraphNodeSource(`import { value } from './value.ts'
export default {
  formatVersion: 2,
  id: '${SELF_HASH_PLACEHOLDER}',
  localName: 'LockedProjectionNode',
  label: 'Locked projection node',
  version: 1,
  localParamsSchema: {},
  outputSchema: {},
  inputs: {},
  moduleLockId: '${lock.id}',
  run: () => value,
}`)
  await repository.putModule(module)
  await repository.putModuleLock(lock)
  await memory.store.writeText(`nodes/${hashFilePart(node.hash)}.ts`, node.file.source)

  const projection = await projectDesignGraphSnapshot({
    store: memory.store,
    selector: { kind: 'node', nodeId: node.hash },
  })
  const paths = projection.map(({ path }) => path)
  assert(paths.includes(`nodes/${hashFilePart(node.hash)}.ts`), 'Expected projected node source')
  assert(
    paths.includes(`module-locks/${hashFilePart(lock.id)}.json`),
    'Expected projected module lock',
  )
  assert(
    paths.includes(`modules/${hashFilePart(module.id)}.json`),
    'Expected projected module object',
  )
}

testNodeGitProjectionIncludesLockedModuleClosure.description =
  'Projects imported stored nodes with their exact module lock and module objects.'

export const testStoredModuleEditRewritesEverySharingNodeAndItsDependents = async () => {
  const module = createDagModuleArtifact({
    mediaType: 'text/typescript',
    source: 'export const value = 1',
  })
  const lock = createDagModuleLock({
    imports: { $node: { './value.ts': { kind: 'module', id: module.id } } },
  })
  const first = await saveStoredGraphNodeSource(`import { value } from './value.ts'
export default {
  formatVersion: 2,
  id: '${SELF_HASH_PLACEHOLDER}',
  localName: 'FirstModuleConsumer',
  label: 'First module consumer',
  version: 1,
  localParamsSchema: {},
  outputSchema: {},
  inputs: {},
  moduleLockId: '${lock.id}',
  run: () => value,
}`)
  const second = await saveStoredGraphNodeSource(
    first.file.source.replaceAll('FirstModuleConsumer', 'SecondModuleConsumer'),
  )
  const downstream = await saveStoredGraphNodeSource(`export default {
  formatVersion: 2,
  id: '${SELF_HASH_PLACEHOLDER}',
  localName: 'ModuleConsumerOutput',
  label: 'Module consumer output',
  version: 1,
  localParamsSchema: {},
  outputSchema: {},
  inputs: { value: { nodeId: '${first.hash}', role: 'internal' } },
  run: ({ use }) => use.value,
}`)

  const replaced = await replaceDagNodeRecordModuleSource({
    definitions: [first.node, second.node, downstream.node],
    locks: { [lock.id]: lock },
    modules: { [module.id]: module },
    moduleId: module.id,
    source: 'export const value = 2',
  })
  const replacementLock = replaced.locks[0]
  assert(replacementLock, 'Expected a replacement module lock')
  const firstUpdated = replaced.definitions.find(
    ({ localName }) => localName === first.node.localName,
  )
  const secondUpdated = replaced.definitions.find(
    ({ localName }) => localName === second.node.localName,
  )
  const downstreamUpdated = replaced.definitions.find(
    ({ localName }) => localName === downstream.node.localName,
  )
  assert(
    firstUpdated?.moduleLockId === replacementLock.id,
    'Expected first shared lock replacement',
  )
  assert(
    secondUpdated?.moduleLockId === replacementLock.id,
    'Expected second shared lock replacement',
  )
  assert(firstUpdated.id !== first.node.id, 'Expected first consumer identity to change')
  assert(secondUpdated.id !== second.node.id, 'Expected second consumer identity to change')
  assert(
    downstreamUpdated?.inputs?.value &&
      !('kind' in downstreamUpdated.inputs.value) &&
      downstreamUpdated.inputs.value.nodeId === firstUpdated.id,
    'Expected downstream input hashes to follow the edited module consumer',
  )
  assert(replaced.module.source === 'export const value = 2', 'Expected replacement source')
  assert(module.source === 'export const value = 1', 'Expected the old module to stay immutable')
}

testStoredModuleEditRewritesEverySharingNodeAndItsDependents.description =
  'Replaces a shared stored module once, then rewrites every consuming node and dependent hash.'

export const testPackageUpdateCreatesImmutableReplacementPath = async () => {
  const lock = createDagModuleLock({
    imports: { $node: { zod: { kind: 'package', name: 'zod' } } },
    packages: { zod: { range: '^4.0.0' } },
  })
  const node = await saveStoredGraphNodeSource(`import { z } from 'zod'
export default {
  formatVersion: 2,
  id: '${SELF_HASH_PLACEHOLDER}',
  localName: 'PackageConsumer',
  label: 'Package consumer',
  version: 1,
  localParamsSchema: {},
  outputSchema: {},
  inputs: {},
  moduleLockId: '${lock.id}',
  run: () => z.number().parse(1),
}`)
  const updated = await replaceDagNodeRecordPackageRange({
    definitions: [node.node],
    locks: { [lock.id]: lock },
    packageName: 'zod',
    range: '^4.1.0',
  })
  assert(updated.locks[0]?.packages.zod?.range === '^4.1.0', 'Expected the new package range')
  assert(updated.definitions[0]?.id !== node.hash, 'Expected a new immutable node identity')
  assert(updated.definitions[0]?.version === 2, 'Expected an explicit node revision')
}

testPackageUpdateCreatesImmutableReplacementPath.description =
  'Updates an incompatible package requirement by rewriting locks and node identities.'

export const testProjectSaveUsesConditionalWritesAndExplicitParents = async () => {
  const repository = createDesignGraphRepository(createMemoryStore().store)
  const first = createProjectRevision({
    parents: [],
    displayName: 'First',
    invocations: {},
    extensions: {},
  })
  await repository.putProjectRevision(first)
  await repository.advanceProjectRef({ name: 'projects/cas', revisionId: first.id, expected: null })

  const second = createProjectRevision({
    parents: [first.id],
    displayName: 'Second',
    invocations: {},
    extensions: {},
  })
  await repository.putProjectRevision(second)
  await repository.advanceProjectRef({
    name: 'projects/cas',
    revisionId: second.id,
    expected: first.id,
  })

  let conflict = false
  try {
    await repository.advanceProjectRef({
      name: 'projects/cas',
      revisionId: first.id,
      expected: null,
    })
  } catch {
    conflict = true
  }
  assert(conflict, 'Expected stale project ref update to conflict')
  assert(second.parents[0] === first.id, 'Expected explicit immutable revision ancestry')

  const third = createProjectRevision({
    parents: [second.id],
    displayName: 'Third',
    invocations: {},
    extensions: {},
  })
  const fourth = createProjectRevision({
    parents: [second.id],
    displayName: 'Fourth',
    invocations: {},
    extensions: {},
  })
  await Promise.all([repository.putProjectRevision(third), repository.putProjectRevision(fourth)])
  const updates = await Promise.allSettled([
    repository.advanceProjectRef({
      name: 'projects/cas',
      revisionId: third.id,
      expected: second.id,
    }),
    repository.advanceProjectRef({
      name: 'projects/cas',
      revisionId: fourth.id,
      expected: second.id,
    }),
  ])
  assert(
    updates.filter(({ status }) => status === 'fulfilled').length === 1,
    'Expected exactly one concurrent ref update to succeed',
  )
}

testProjectSaveUsesConditionalWritesAndExplicitParents.description =
  'Advances stable project refs only when unchanged while keeping revision ancestry immutable.'

export const testProjectDraftHistoryPersistsAndSavesCanonicalRevision = async () => {
  const memory = createMemoryStore()
  const repository = createDesignGraphRepository(memory.store)
  const storageValues = new Map<string, unknown>()
  const drafts = createProjectDraftStore(
    {
      get: ({ namespace, id }) =>
        Promise.resolve({ value: storageValues.get(`${namespace}/${id}`) ?? null }),
      set: ({ namespace, id, value }) => {
        storageValues.set(`${namespace}/${id}`, value)
        return Promise.resolve()
      },
      list: ({ namespace }) =>
        Promise.resolve({
          rows: [...storageValues.entries()]
            .filter(([key]) => key.startsWith(`${namespace}/`))
            .map(([key, data]) => ({ id: key.slice(namespace.length + 1), data })),
        }),
    },
    3,
  )
  const projectRef = 'projects/draft-test'
  const initial = createProjectRevision({
    parents: [],
    displayName: 'Initial',
    invocations: {},
    extensions: {},
  })
  await repository.putProjectRevision(initial)
  await repository.advanceProjectRef({ name: projectRef, revisionId: initial.id, expected: null })
  await drafts.create(projectRef, initial)
  await drafts.update(projectRef, (snapshot) => ({ ...snapshot, displayName: 'First edit' }))
  await drafts.update(projectRef, (snapshot) => ({ ...snapshot, displayName: 'Second edit' }))
  await drafts.update(projectRef, (snapshot) => ({ ...snapshot, displayName: 'Third edit' }))

  assert((await drafts.load(projectRef))?.snapshots.length === 3, 'Expected bounded history')
  assert((await drafts.undo(projectRef)).current.displayName === 'Second edit', 'Expected undo')
  assert((await drafts.redo(projectRef)).current.displayName === 'Third edit', 'Expected redo')

  const saved = await drafts.save(projectRef, repository)
  assert(saved.parents[0] === initial.id, 'Expected the draft base revision as parent')
  assert(saved.displayName === 'Third edit', 'Expected the current snapshot to be saved')
  assert(
    (await repository.getProjectRef(projectRef))?.revisionId === saved.id,
    'Expected save to advance the canonical project ref',
  )
  const reset = await drafts.load(projectRef)
  assert(reset?.baseRevisionId === saved.id, 'Expected saved revision to become the draft base')
  assert(reset?.snapshots.length === 1 && reset.cursor === 0, 'Expected save to reset history')
}

testProjectDraftHistoryPersistsAndSavesCanonicalRevision.description =
  'Persists bounded project draft undo/redo and saves through canonical immutable project revisions.'

export const testInvocationRunRejectsApproximationUntilAvailable = () => {
  const invocationId = canonicalHash('approximation')
  let rejected = false
  try {
    createInvocationRun({
      invocationId,
      resolvedPolicy: {
        engine: { id: 'taskyon', version: 1 },
        accuracy: 'approximate',
        strategies: {},
      },
      status: 'completed',
      startedAtMs: 1,
      completedAtMs: 2,
      artifacts: { rows: canonicalHash('approximate-rows') },
      provenance: {},
    })
  } catch {
    rejected = true
  }
  assert(rejected, 'Expected unavailable approximation to be rejected')
}

testInvocationRunRejectsApproximationUntilAvailable.description =
  'Rejects explicit approximate execution until an estimator capability exists.'

export const testInvocationCandidatesRemainPullBased = () => {
  const invocation = createInvocationDefinition({
    rootNodeId: canonicalHash('pull-root'),
    variables: {
      first: { kind: 'sweep', method: 'linear', start: 1, end: 1_000_000, step: 1 },
      second: { kind: 'grid', values: ['a', 'b'] },
    },
    objectives: [],
    constraints: [],
    policy: { accuracy: 'auto' },
    reducerOverrides: {},
  })
  const iterator = iterateInvocationCandidates(invocation)[Symbol.iterator]()
  const first = iterator.next()
  const second = iterator.next()
  iterator.return?.()
  assert(first.value?.first === 1 && first.value?.second === 'a', 'Expected first candidate')
  assert(second.value?.first === 1 && second.value?.second === 'b', 'Expected second candidate')
}

testInvocationCandidatesRemainPullBased.description =
  'Pulls candidates lazily without allocating a complete Cartesian-product array.'

export const testDerivedReducerSharesCanonicalCache = async () => {
  const sourceArtifactId = canonicalHash('derived-source')
  const expression = createDerivedExpression({
    sourceArtifactId,
    operations: [
      { kind: 'select', path: 'cost' },
      { kind: 'reduce', reducer: 'mean' },
    ],
  })
  const cache = new Map<string, unknown>()
  let reads = 0
  const evaluate = () =>
    evaluateDerivedExpression({
      expression,
      readRows: async function* () {
        reads += 1
        yield await Promise.resolve({ cost: 2 })
        yield { cost: 4 }
      },
      cache: {
        get: (key) =>
          Promise.resolve(cache.has(key) ? { hit: true, value: cache.get(key) } : { hit: false }),
        set: (key, value) => {
          cache.set(key, value)
          return Promise.resolve()
        },
      },
    })
  assert((await evaluate()) === 3, 'Expected canonical mean reducer result')
  assert((await evaluate()) === 3, 'Expected cached mean reducer result')
  assert(reads === 1, 'Expected the second consumer to reuse the derived cache')
}

testDerivedReducerSharesCanonicalCache.description =
  'Shares structurally hashed derived reducer results across independent consumers.'

export const testInvocationExecutionUsesCanonicalObjectivesAndConstraints = async () => {
  const repository = createDesignGraphRepository(createMemoryStore().store)
  const invocation = createInvocationDefinition({
    rootNodeId: canonicalHash('objective-root'),
    variables: { sample: { kind: 'constant', value: 1 } },
    objectives: [{ direction: 'min', target: { path: 'costs', op: 'sum' } }],
    constraints: [{ path: 'capacity', operator: '>=', limit: 5 }],
    policy: { accuracy: 'exact' },
    reducerOverrides: {},
  })
  await repository.putInvocation(invocation)
  const artifacts = new Map<Hash, Uint8Array<ArrayBuffer>>()
  const begin = (mediaType: string): Promise<StagedArtifactWriter> => {
    const chunks: Uint8Array[] = []
    return Promise.resolve({
      write: (chunk) => {
        chunks.push(new Uint8Array(chunk))
        return Promise.resolve()
      },
      commit: () => {
        const size = chunks.reduce((total, chunk) => total + chunk.byteLength, 0)
        const bytes = new Uint8Array(size)
        let offset = 0
        for (const chunk of chunks) {
          bytes.set(chunk, offset)
          offset += chunk.byteLength
        }
        const id = canonicalHash([...bytes])
        artifacts.set(id, bytes)
        return Promise.resolve({ id, size, mediaType })
      },
      abort: () => Promise.resolve(),
    })
  }
  let observed: unknown
  let evaluations = 0
  let attempt = 0
  const artifactStore = {
    begin,
    write: async (value: unknown, mediaType: string) => {
      const writer = await begin(mediaType)
      await writer.write(new TextEncoder().encode(JSON.stringify(value)))
      return await writer.commit()
    },
    exists: (artifact: { id: Hash }) => Promise.resolve(artifacts.has(artifact.id)),
  }
  const evaluate = () => {
    evaluations += 1
    return Promise.resolve({ outputs: { costs: [2, 3, 4], capacity: 7 } })
  }
  const completed = await executeInvocation({
    invocation,
    dependencies: {
      repository,
      artifacts: artifactStore,
      evaluate,
      makeAttemptId: () => `objective-attempt-${attempt++}`,
      now: () => 10 + attempt,
    },
    onRow: (row) => {
      observed = row
    },
  })
  const row = observed as { objectives: Record<string, number | null>; feasible: boolean }
  assert(row.objectives['objective-0'] === 9, 'Expected canonical sum objective')
  assert(row.feasible, 'Expected satisfied constraints to mark the row feasible')
  assert(completed.run.status === 'completed', 'Expected a completed immutable run')
  const refreshed = await executeInvocation({
    invocation,
    reuseCompletedRun: false,
    dependencies: {
      repository,
      artifacts: artifactStore,
      evaluate,
      makeAttemptId: () => `objective-attempt-${attempt++}`,
      now: () => 10 + attempt,
    },
  })
  assert(!refreshed.cacheHit, 'Expected explicit refresh to bypass completed invocation reuse')
  assert(evaluations === 2, 'Expected explicit refresh to evaluate the invocation again')
}

testInvocationExecutionUsesCanonicalObjectivesAndConstraints.description =
  'Evaluates invocation reducers and constraints while streaming rows into named artifacts.'

export const testInvocationRowsAreReadThroughBoundedArtifactRanges = async () => {
  const encoder = new TextEncoder()
  const rows = [
    {
      rowId: 0,
      params: {},
      outputs: { value: 1 },
      objectives: {},
      constraints: {},
      feasible: true,
    },
    {
      rowId: 1,
      params: {},
      outputs: { value: 2 },
      objectives: {},
      constraints: {},
      feasible: true,
    },
    {
      rowId: 2,
      params: {},
      outputs: { value: 3 },
      objectives: {},
      constraints: {},
      feasible: true,
    },
  ]
  const rowLines = rows.map((row) => encoder.encode(`${JSON.stringify(row)}\n`))
  let offset = 0
  const indexLines = rowLines.map((bytes, rowId) => {
    const entry = encoder.encode(`${JSON.stringify({ rowId, offset, length: bytes.byteLength })}\n`)
    offset += bytes.byteLength
    return entry
  })
  const join = (chunks: Uint8Array[]) => {
    const output = new Uint8Array(chunks.reduce((size, chunk) => size + chunk.byteLength, 0))
    let cursor = 0
    for (const chunk of chunks) {
      output.set(chunk, cursor)
      cursor += chunk.byteLength
    }
    return output
  }
  const rowsBytes = join(rowLines)
  const indexBytes = join(indexLines)
  const rowsId = canonicalHash([...rowsBytes])
  const indexId = canonicalHash([...indexBytes])
  const blobs = new Map([
    [rowsId.replace(':', '_'), rowsBytes],
    [indexId.replace(':', '_'), indexBytes],
  ])
  let largestRead = 0
  const selected = []
  for await (const row of iterateInvocationRowRange({
    storage: {
      readBlobRange: ({ id, offset: readOffset, length }) => {
        largestRead = Math.max(largestRead, length)
        const blob = blobs.get(id)
        if (!blob) throw new Error(`Missing test blob ${id}`)
        const data = blob.slice(readOffset, readOffset + length)
        const nextOffset = readOffset + data.byteLength
        return Promise.resolve({ data, nextOffset, eof: nextOffset >= blob.byteLength })
      },
    },
    rows: { id: rowsId },
    rowIndex: { id: indexId },
    startRow: 1,
    limit: 1,
    chunkBytes: 1024,
  })) {
    selected.push(row)
  }
  assert(selected.length === 1 && selected[0]?.rowId === 1, 'Expected one indexed row range')
  assert(largestRead <= 1024, 'Expected bounded artifact reads')
}

testInvocationRowsAreReadThroughBoundedArtifactRanges.description =
  'Reads selected invocation rows lazily through the named row-index artifact.'
