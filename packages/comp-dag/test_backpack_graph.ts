import type { Hash } from './caching.ts'
import { defineDagNodeRecord, type DagNodeRecord } from './dagNodeRecord.ts'
import {
  canReadStoredGraphNodeDirectory,
  compileDagNodeRecordGraph,
  loadDagNodeRecordGraph,
  readStoredGraphNodeDirectory,
  savedStoredNodesToRecordGraph,
} from './dagNodeGraph.ts'
import { createDagGraphPatchTool } from './dagGraphTool.ts'
import { loadStoredGraphNodeFiles, type StoredGraphNodeFile } from './dagNodeLoader.ts'
import { createStoredDagGraph, getStoredDagGraphLocalNameIndex } from './storedDagGraph.ts'

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

const hashFromFilePath = (file: StoredGraphNodeFile): Hash => {
  const filename = file.path.split('/').at(-1) ?? file.path
  const match = /(?:^|\.)(sha256_[A-Za-z0-9_-]+)\.ts$/.exec(filename)
  const filePart = match?.[1]
  assert(filePart, `Expected hash in node filename ${file.path}`)
  return `sha256:${filePart.slice('sha256_'.length)}`
}

const staticSummaryRunSource = `async ({ use }) => {
  const recommendation = await use.recommendation()
  return {
    summary: \`\${recommendation.itemNames.length} items / \${recommendation.totalWeightKg}kg\`,
    itemCount: recommendation.itemNames.length,
  }
}`

const createStaticSummaryRecord = async (recommendationHash: Hash): Promise<DagNodeRecord> => {
  const staticDependencyFingerprint = {
    importSpecifiers: ['@taskyon/comp-dag/dagNodeRecord'],
  }
  return await defineDagNodeRecord({
    formatVersion: 2,
    localName: 'static_backpack_summary',
    label: 'Static Backpack Summary',
    version: 1,
    localParamsSchema: {
      additionalProperties: false,
      properties: {},
      type: 'object',
    },
    outputSchema: {
      additionalProperties: false,
      properties: {
        itemCount: { type: 'number' },
        summary: { type: 'string' },
      },
      required: ['summary', 'itemCount'],
      type: 'object',
    },
    inputs: {
      recommendation: { nodeId: recommendationHash, role: 'exposed' },
    },
    runSource: staticSummaryRunSource,
    run: async ({ use }) => {
      const recommendation = (await use.recommendation()) as {
        itemNames: string[]
        totalWeightKg: number
      }
      return {
        summary: `${recommendation.itemNames.length} items / ${recommendation.totalWeightKg}kg`,
        itemCount: recommendation.itemNames.length,
      }
    },
    staticDependencyFingerprint,
  })
}

const runBackpackRoot = async (files: readonly StoredGraphNodeFile[], rootHash: Hash) => {
  const graph = await loadDagNodeRecordGraph(files)
  assert(graph[rootHash], `Expected graph store to contain root ${rootHash}`)
  const compiled = compileDagNodeRecordGraph({ graph, rootHash })
  const root = compiled[rootHash]
  assert(root, `Expected compiled root node ${rootHash}`)
  const compiledRoot = root
  assert(compiledRoot.contentHash === rootHash, `Expected root content hash ${rootHash}`)
  assert(compiledRoot.localName === 'packing_recommendation', 'Expected root local name')

  const { value } = await compiledRoot.call({ policy: {} }).run()
  return {
    rootHash,
    files,
    value: value as {
      itemNames: string[]
      totalWeightKg: number
      maxWeightKg: number
      score: number
    },
  }
}

const patchBackpackMaxWeight = async (
  files: readonly StoredGraphNodeFile[],
  rootHash: Hash,
  maxWeightKg: number,
) => {
  const storedGraph = await createStoredDagGraph({ files, roots: { main: rootHash } })
  const localNameIndex = getStoredDagGraphLocalNameIndex({ storedGraph, rootName: 'main' })
  const requirementsHash = localNameIndex.trip_requirements
  assert(requirementsHash, 'Expected selected graph to contain trip requirements')
  const requirements = storedGraph.nodesByHash[requirementsHash]
  assert(requirements, 'Expected stored graph to contain trip requirements')

  const dagGraphPatchTool = createDagGraphPatchTool(createIdentityTool)
  const result = await dagGraphPatchTool.function({
    projectId: 'backpack',
    files: [...files],
    roots: storedGraph.roots,
    rootName: 'main',
    targetLocalName: 'trip_requirements',
    source: requirements.file.source.replace('maxWeightKg: 7', `maxWeightKg: ${maxWeightKg}`),
  })

  const newHash = (localName: string): Hash =>
    result.changedNodes[localName]?.newHash ?? localNameIndex[localName]!

  return {
    files: [...files, ...result.createdFiles],
    oldHashes: {
      requirements: localNameIndex.trip_requirements!,
      weightCheck: localNameIndex.weight_check!,
      weatherCheck: localNameIndex.weather_check!,
      utilityScore: localNameIndex.utility_score!,
      recommendation: localNameIndex.packing_recommendation!,
      candidates: localNameIndex.item_candidates!,
      policy: localNameIndex.recommendation_policy!,
    },
    newHashes: {
      requirements: newHash('trip_requirements'),
      weightCheck: newHash('weight_check'),
      weatherCheck: newHash('weather_check'),
      utilityScore: newHash('utility_score'),
      recommendation: newHash('packing_recommendation'),
      candidates: newHash('item_candidates'),
      policy: newHash('recommendation_policy'),
    },
  }
}

const loadBackpackNodeFiles = async (): Promise<StoredGraphNodeFile[]> => {
  const nodesUrl = new URL('./examples/backpack/nodes/', import.meta.url)
  return await readStoredGraphNodeDirectory(nodesUrl)
}

const findBackpackRootHash = (files: readonly StoredGraphNodeFile[]): Hash => {
  const rootHashes = files
    .filter((file) => file.path.includes('packing_recommendation.'))
    .map(hashFromFilePath)
    .sort()
  assert(
    rootHashes.length === 1,
    `Expected one initial recommendation root, got ${rootHashes.length}`,
  )
  return rootHashes[0]!
}

const createIdentityTool = <T>(tool: T): T => tool

export const testStoredDagNodesEvaluateInputsLazily = async () => {
  let selectedRuns = 0
  let unusedRuns = 0

  const selected = await defineDagNodeRecord({
    formatVersion: 2,
    localName: 'selected_input',
    label: 'Selected Input',
    version: 1,
    localParamsSchema: {},
    outputSchema: {},
    runSource: `() => ({ value: 'selected' })`,
    run: () => {
      selectedRuns += 1
      return { value: 'selected' }
    },
  })
  const unused = await defineDagNodeRecord({
    formatVersion: 2,
    localName: 'unused_input',
    label: 'Unused Input',
    version: 1,
    localParamsSchema: {},
    outputSchema: {},
    runSource: `() => ({ value: 'unused' })`,
    run: () => {
      unusedRuns += 1
      return { value: 'unused' }
    },
  })
  const root = await defineDagNodeRecord({
    formatVersion: 2,
    localName: 'lazy_root',
    label: 'Lazy Root',
    version: 1,
    localParamsSchema: {},
    outputSchema: {},
    inputs: {
      selected: { nodeId: selected.id, role: 'internal' },
      unused: { nodeId: unused.id, role: 'internal' },
    },
    runSource: `async ({ use }) => await use.selected({})`,
    runCode: `async ({ use }) => await use.selected({})`,
  })
  const compiled = compileDagNodeRecordGraph({
    graph: {
      [selected.id]: selected,
      [unused.id]: unused,
      [root.id]: root,
    },
    rootHash: root.id,
  })
  const compiledRoot = compiled[root.id]
  assert(compiledRoot, 'Expected lazy stored root to compile')

  const result = await compiledRoot.call({}).run()

  assert(
    JSON.stringify(result.value) === JSON.stringify({ value: 'selected' }),
    'Expected selected stored input result',
  )
  assert(selectedRuns === 1, 'Expected the requested stored input to run once')
  assert(unusedRuns === 0, 'Expected the unrequested stored input to remain unevaluated')

  return { selectedRuns, unusedRuns, value: result.value }
}

testStoredDagNodesEvaluateInputsLazily.description =
  'Proves sandboxed stored nodes request only the dependencies they use.'

export const testStoredExplodeNodeEnumeratesStructuralAlternatives = async () => {
  let catalogRuns = 0
  const catalog = await defineDagNodeRecord({
    formatVersion: 2,
    localName: 'configuration_catalog',
    label: 'Configuration Catalog',
    version: 1,
    localParamsSchema: { additionalProperties: false, properties: {}, type: 'object' },
    outputSchema: {
      additionalProperties: false,
      properties: {
        configurations: {
          items: {
            additionalProperties: false,
            properties: { id: { type: 'string' }, score: { type: 'number' } },
            required: ['id', 'score'],
            type: 'object',
          },
          type: 'array',
        },
      },
      required: ['configurations'],
      type: 'object',
    },
    runSource: `() => ({ configurations: [{ id: 'a', score: 1 }, { id: 'b', score: 2 }] })`,
    run: () => {
      catalogRuns += 1
      return {
        configurations: [
          { id: 'a', score: 1 },
          { id: 'b', score: 2 },
        ],
      }
    },
  })
  const selected = await defineDagNodeRecord({
    formatVersion: 2,
    localName: 'selected_configuration',
    label: 'Selected Configuration',
    version: 1,
    structure: {
      kind: 'explode',
      sourceAlias: 'source',
      path: 'configurations',
    },
    localParamsSchema: {},
    outputSchema: {},
    inputs: {
      source: { nodeId: catalog.id, role: 'internal' },
    },
    runSource: `() => {
      throw new Error('Stored explode nodes are compiled structurally')
    }`,
  })
  const root = await defineDagNodeRecord({
    formatVersion: 2,
    localName: 'configuration_result',
    label: 'Configuration Result',
    version: 1,
    localParamsSchema: {},
    outputSchema: {},
    inputs: {
      configuration: { nodeId: selected.id, role: 'exposed' },
    },
    runSource: `async ({ use }) => await use.configuration()`,
    run: async ({ use }) => await use.configuration!(),
  })
  const compiled = compileDagNodeRecordGraph({
    graph: {
      [catalog.id]: catalog,
      [selected.id]: selected,
      [root.id]: root,
    },
    rootHash: root.id,
  })
  const compiledRoot = compiled[root.id]
  assert(compiledRoot, 'Expected stored structural graph to compile')

  const study = await compiledRoot.call({ configuration: {} }).study({
    mode: 'optimize',
    objective: { path: 'score', direction: 'max' },
  })

  assert(study.rows.length === 2, 'Expected one row per stored structural alternative')
  const best = study.best as { id?: unknown } | null
  assert(best?.id === 'b', 'Expected objective to select the higher-scoring alternative')
  assert(catalogRuns > 0, 'Expected the structural catalog to resolve on demand')
  return { rows: study.rows.length, best: study.best, catalogRuns }
}

testStoredExplodeNodeEnumeratesStructuralAlternatives.description =
  'Proves persisted explode metadata compiles into lazy structural study enumeration.'

export const testStoredDagNodeTimeoutClosesPendingDependencyProtocolSafely = async () => {
  const slowInput = await defineDagNodeRecord({
    formatVersion: 2,
    localName: 'slow_input',
    label: 'Slow Input',
    version: 1,
    localParamsSchema: {},
    outputSchema: {},
    runSource: `async () => ({ value: 'slow' })`,
    run: async () => {
      await new Promise((resolve) => globalThis.setTimeout(resolve, 150))
      return { value: 'slow' }
    },
  })
  const root = await defineDagNodeRecord({
    formatVersion: 2,
    localName: 'timed_root',
    label: 'Timed Root',
    version: 1,
    timeoutMs: 100,
    localParamsSchema: {},
    outputSchema: {},
    inputs: {
      slow: { nodeId: slowInput.id, role: 'internal' },
    },
    runSource: `async ({ use }) => await use.slow({})`,
    runCode: `async ({ use }) => await use.slow({})`,
  })
  const compiled = compileDagNodeRecordGraph({
    graph: {
      [slowInput.id]: slowInput,
      [root.id]: root,
    },
    rootHash: root.id,
  })
  const compiledRoot = compiled[root.id]
  assert(compiledRoot, 'Expected timed stored root to compile')

  let message = ''
  let errorName = ''
  try {
    await compiledRoot.call({}).run()
  } catch (error) {
    message = error instanceof Error ? error.message : String(error)
    errorName = error instanceof Error ? error.name : ''
  }
  await new Promise((resolve) => globalThis.setTimeout(resolve, 100))

  assert(
    errorName === 'AbortError',
    `Expected stored node timeout to raise AbortError, received: ${errorName}`,
  )
  assert(
    message === `DAG node ${root.id} timed out after 100ms`,
    `Expected stored node timeout to interrupt execution, received: ${message}`,
  )
  return { errorName, message }
}

testStoredDagNodeTimeoutClosesPendingDependencyProtocolSafely.description =
  'Proves a timed-out stored node ignores a dependency protocol result after its sandbox closes.'

export const testBackpackProjectGraphPatchUpdatesSelectedRoot = async () => {
  if (!canReadStoredGraphNodeDirectory()) {
    return { skipped: true, reason: 'Backpack project graph patch diagnostic requires Node.' }
  }

  const files = await loadBackpackNodeFiles()
  const initialRootHash = findBackpackRootHash(files)
  const storedGraph = await createStoredDagGraph({
    files,
    roots: { main: initialRootHash },
  })
  const localNameIndex = getStoredDagGraphLocalNameIndex({ storedGraph, rootName: 'main' })
  const initial = await runBackpackRoot(storedGraph.files, storedGraph.roots.main!)
  const targetHash = localNameIndex.trip_requirements
  assert(targetHash, 'Expected selected graph to contain trip requirements')
  const targetNode = storedGraph.nodesByHash[targetHash]
  assert(targetNode, 'Expected stored graph to contain selected target node')
  const dagGraphPatchTool = createDagGraphPatchTool(createIdentityTool)
  const graphPatchResult = await dagGraphPatchTool.function({
    projectId: 'backpack',
    files,
    roots: storedGraph.roots,
    rootName: 'main',
    targetLocalName: 'trip_requirements',
    source: targetNode.file.source.replace('maxWeightKg: 7', 'maxWeightKg: 5'),
  })
  const patchedFiles = [...files, ...graphPatchResult.createdFiles]
  const patchedRootHash = graphPatchResult.nextRoots.main
  assert(patchedRootHash, 'Expected patched project to keep main root')
  const patchedGraph = await createStoredDagGraph({
    files: patchedFiles,
    roots: graphPatchResult.nextRoots,
  })
  const patchedRun = await runBackpackRoot(patchedFiles, patchedRootHash)
  const oldRootRun = await runBackpackRoot(patchedFiles, initialRootHash)

  assert(initial.rootHash === initialRootHash, 'Expected project pointer to select initial root')
  assert(initial.value.maxWeightKg === 7, 'Expected initial graph max weight')
  assert(graphPatchResult.type === 'graphPatchResult', 'Expected structured graph patch result')
  assert(graphPatchResult.projectId === 'backpack', 'Expected patch result project id')
  assert(
    graphPatchResult.previousRoots.main === initialRootHash,
    'Expected patch result to record previous root',
  )
  assert(
    graphPatchResult.nextRoots.main === patchedRootHash,
    'Expected patch result to record next root',
  )
  assert(
    graphPatchResult.resolvedOldHash === localNameIndex.trip_requirements,
    'Expected patch result to record resolved target hash',
  )
  assert(patchedRootHash !== initialRootHash, 'Expected project pointer root to change')
  assert(patchedRun.value.maxWeightKg === 5, 'Expected patched graph max weight')
  assert(oldRootRun.value.maxWeightKg === 7, 'Expected old graph root to remain runnable')
  assert(
    patchedRun.value.itemNames.length < initial.value.itemNames.length ||
      patchedRun.value.totalWeightKg < initial.value.totalWeightKg,
    'Expected patched run to recommend fewer or lighter items',
  )

  const expectedChanged = [
    'trip_requirements',
    'weight_check',
    'weather_check',
    'utility_score',
    'packing_recommendation',
  ]
  for (const localName of expectedChanged) {
    const change = graphPatchResult.changedNodes[localName]
    assert(change, `Expected changed node ${localName}`)
    assert(change.oldHash !== change.newHash, `Expected ${localName} hash to change`)
  }

  assert(
    graphPatchResult.changedNodes.item_candidates === undefined,
    'Expected item candidates to remain unchanged',
  )
  assert(
    graphPatchResult.changedNodes.recommendation_policy === undefined,
    'Expected recommendation policy to remain unchanged',
  )
  assert(
    patchedGraph.graph[patchedRootHash],
    `Expected patched graph store to contain new root ${patchedRootHash}`,
  )
  assert(
    patchedGraph.graph[initialRootHash],
    `Expected patched graph store to retain old root ${initialRootHash}`,
  )

  return {
    initialRoot: initialRootHash,
    patchedRoot: patchedRootHash,
    initialResult: initial.value,
    patchedResult: patchedRun.value,
    oldRootResult: oldRootRun.value,
    graphPatchResult,
  }
}

testBackpackProjectGraphPatchUpdatesSelectedRoot.description =
  'Runs the Backpack project graph before and after a local-name patch and advances the selected root.'

export const testBackpackGraphLoadsImmutableTypeScriptNodeDirectory = async () => {
  if (!canReadStoredGraphNodeDirectory()) {
    return { skipped: true, reason: 'Backpack graph file-directory diagnostic requires Node.' }
  }

  const files = await loadBackpackNodeFiles()
  const rootHash = findBackpackRootHash(files)

  const initial = await runBackpackRoot(files, rootHash)
  const patched = await patchBackpackMaxWeight(files, rootHash, 5)
  const patchedRun = await runBackpackRoot(patched.files, patched.newHashes.recommendation)
  const patchedNodesByHash = await loadStoredGraphNodeFiles(patched.files)
  const staticSummary = await createStaticSummaryRecord(patched.newHashes.recommendation)
  const mixedCompiled = compileDagNodeRecordGraph({
    graph: {
      ...savedStoredNodesToRecordGraph(patchedNodesByHash),
      [staticSummary.id]: staticSummary,
    },
    rootHash: staticSummary.id,
  })
  const mixedSummaryNode = mixedCompiled[staticSummary.id]
  assert(mixedSummaryNode, 'Expected mixed static summary node to compile')
  const compiledMixedSummaryNode = mixedSummaryNode
  assert(
    compiledMixedSummaryNode.contentHash === staticSummary.id,
    'Expected static summary node to use its record hash',
  )
  const mixedSummary = await compiledMixedSummaryNode.call({ recommendation: { policy: {} } }).run()

  assert(initial.rootHash !== patchedRun.rootHash, 'Expected upstream patch to change root hash')
  assert(initial.value.maxWeightKg === 7, 'Expected initial graph max weight')
  assert(patchedRun.value.maxWeightKg === 5, 'Expected patched graph max weight')
  assert(
    initial.value.itemNames.length > patchedRun.value.itemNames.length,
    'Expected lower-weight graph to recommend fewer items',
  )
  assert(
    patched.files.every((file) => file.path.includes('sha256_') && file.path.endsWith('.ts')),
    'Expected normalized TypeScript node hash in every filename',
  )
  const mixedSummaryValue = mixedSummary.value
  assert(
    typeof mixedSummaryValue === 'object' &&
      mixedSummaryValue !== null &&
      'itemCount' in mixedSummaryValue &&
      mixedSummaryValue.itemCount === patchedRun.value.itemNames.length,
    'Expected static in-memory node to consume stored recommendation output',
  )
  for (const name of Object.keys(patched.oldHashes) as Array<keyof typeof patched.oldHashes>) {
    const oldHash = patched.oldHashes[name]
    const newHash = patched.newHashes[name]
    if (name === 'candidates' || name === 'policy') {
      assert(oldHash === newHash, `Expected unchanged leaf ${name} to keep hash`)
    } else {
      assert(oldHash !== newHash, `Expected patched downstream node ${name} to change hash`)
      assert(patchedNodesByHash[newHash], `Expected patched store to contain ${name} ${newHash}`)
    }
  }

  return {
    initialRoot: initial.rootHash,
    patchedRoot: patchedRun.rootHash,
    initialResult: initial.value,
    patchedResult: patchedRun.value,
    mixedStaticSummary: mixedSummary.value,
    mixedStaticSummaryHash: staticSummary.id,
    oldHashes: patched.oldHashes,
    newHashes: patched.newHashes,
  }
}

testBackpackGraphLoadsImmutableTypeScriptNodeDirectory.description =
  'Loads the backpack optimizer from real immutable TypeScript node directories.'
