import type { Hash } from '@taskyon/comp-dag/caching'
import {
  canReadStoredGraphNodeDirectory,
  compileDagNodeRecordGraph,
  loadDagNodeRecordGraph,
  readStoredGraphNodeDirectory,
} from '@taskyon/comp-dag/dagNodeGraph'
import { loadStoredGraphNodeFiles, type StoredGraphNodeFile } from '@taskyon/comp-dag/dagNodeLoader'
import { createDagGraphPatchTool } from '@taskyon/comp-dag/dagGraphTool'
import {
  createStoredDagGraph,
  getStoredDagGraphLocalNameIndex,
} from '@taskyon/comp-dag/storedDagGraph'

type WorkstationRecommendation = {
  recommendation: {
    id: string
    name: string
    score: number
    viable: boolean
    vramGb: number
    priceUsd: number
  }
  viableCount: number
  ranked: Array<{ id: string; name: string; score: number; viable: boolean }>
  constraints: {
    budgetUsd: number
    powerLimitW: number
    requiredVramGb: number
  }
}

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

const createIdentityTool = <T>(tool: T): T => tool

const runWorkstationRoot = async (
  files: readonly StoredGraphNodeFile[],
  rootHash: Hash,
): Promise<{ rootHash: Hash; value: WorkstationRecommendation }> => {
  const graph = await loadDagNodeRecordGraph(files)
  assert(graph[rootHash], `Expected graph store to contain root ${rootHash}`)
  const compiled = compileDagNodeRecordGraph({ graph, rootHash })
  const root = compiled[rootHash]
  assert(root, `Expected compiled root node ${rootHash}`)
  const compiledRoot = root
  assert(compiledRoot.contentHash === rootHash, `Expected root content hash ${rootHash}`)
  assert(
    compiledRoot.localName === 'workstation_recommendation',
    'Expected workstation root local name',
  )

  const { value } = await compiledRoot.call({ requirements: {} }).run()
  return { rootHash, value: value as WorkstationRecommendation }
}

const patchWorkstationRequiredVram = async (
  files: readonly StoredGraphNodeFile[],
  rootHash: Hash,
  requiredVramGb: number,
) => {
  const storedGraph = await createStoredDagGraph({ files, roots: { main: rootHash } })
  const localNameIndex = getStoredDagGraphLocalNameIndex({ storedGraph, rootName: 'main' })
  const requirementsHash = localNameIndex.workstation_requirements
  assert(requirementsHash, 'Expected selected graph to contain workstation requirements')
  const requirements = storedGraph.nodesByHash[requirementsHash]
  assert(requirements, 'Expected stored graph to contain workstation requirements')

  const dagGraphPatchTool = createDagGraphPatchTool(createIdentityTool)
  const result = await dagGraphPatchTool.function({
    projectId: 'ai-workstation',
    files: [...files],
    roots: storedGraph.roots,
    rootName: 'main',
    targetLocalName: 'workstation_requirements',
    source: requirements.file.source.replace('default: 24', `default: ${requiredVramGb}`),
  })

  const newHash = (localName: string): Hash =>
    result.changedNodes[localName]?.newHash ?? localNameIndex[localName]!

  return {
    files: [...files, ...result.createdFiles],
    oldHashes: {
      requirements: localNameIndex.workstation_requirements!,
      modelRequirements: localNameIndex.model_requirements!,
      candidates: localNameIndex.gpu_candidates!,
      vramCheck: localNameIndex.vram_fit_check!,
      powerCheck: localNameIndex.power_budget_check!,
      costCheck: localNameIndex.cost_check!,
      ranker: localNameIndex.candidate_ranker!,
      recommendation: localNameIndex.workstation_recommendation!,
    },
    newHashes: {
      requirements: newHash('workstation_requirements'),
      modelRequirements: newHash('model_requirements'),
      candidates: newHash('gpu_candidates'),
      vramCheck: newHash('vram_fit_check'),
      powerCheck: newHash('power_budget_check'),
      costCheck: newHash('cost_check'),
      ranker: newHash('candidate_ranker'),
      recommendation: newHash('workstation_recommendation'),
    },
  }
}

export const testAiWorkstationGraphRanksGpuCandidates = async () => {
  if (!canReadStoredGraphNodeDirectory()) {
    return { skipped: true, reason: 'AI workstation graph file diagnostic requires Node.' }
  }

  const nodesUrl = new URL('../examples/nodes/ai-workstation/', import.meta.url)
  const files = await readStoredGraphNodeDirectory(nodesUrl)
  assert(
    files.some((file) => file.path.includes('/20-checks/')),
    'Expected recursive node fixture reader to preserve nested paths',
  )
  const rootHashes = files
    .filter((file) => file.path.includes('workstation_recommendation.'))
    .map(hashFromFilePath)
    .sort()
  assert(
    rootHashes.length === 1,
    `Expected one initial workstation recommendation root, got ${rootHashes.length}`,
  )

  const initial = await runWorkstationRoot(files, rootHashes[0]!)
  const patched = await patchWorkstationRequiredVram(files, rootHashes[0]!, 32)
  const patchedRun = await runWorkstationRoot(patched.files, patched.newHashes.recommendation)
  const patchedNodesByHash = await loadStoredGraphNodeFiles(patched.files)

  assert(initial.rootHash !== patchedRun.rootHash, 'Expected VRAM patch to change root hash')
  assert(initial.value.recommendation.id === 'rtx-3090-used', 'Expected initial best GPU')
  assert(patchedRun.value.recommendation.id === 'rtx-5090', 'Expected VRAM patch best GPU')
  assert(initial.value.constraints.requiredVramGb === 24, 'Expected initial required VRAM')
  assert(patchedRun.value.constraints.requiredVramGb === 32, 'Expected patched required VRAM')
  assert(initial.value.viableCount > patchedRun.value.viableCount, 'Expected fewer viable GPUs')
  assert(
    patched.files.every((file) => file.path.includes('sha256_') && file.path.endsWith('.ts')),
    'Expected normalized TypeScript node hash in every filename',
  )

  for (const name of Object.keys(patched.oldHashes) as Array<keyof typeof patched.oldHashes>) {
    const oldHash = patched.oldHashes[name]
    const newHash = patched.newHashes[name]
    if (name === 'candidates') {
      assert(oldHash === newHash, 'Expected unchanged GPU candidates to keep hash')
    } else {
      assert(oldHash !== newHash, `Expected patched downstream node ${name} to change hash`)
      assert(patchedNodesByHash[newHash], `Expected patched store to contain ${name} ${newHash}`)
    }
  }

  return {
    initialRoot: initial.rootHash,
    patchedRoot: patchedRun.rootHash,
    initialRecommendation: initial.value.recommendation,
    patchedRecommendation: patchedRun.value.recommendation,
    oldHashes: patched.oldHashes,
    newHashes: patched.newHashes,
  }
}

testAiWorkstationGraphRanksGpuCandidates.description =
  'Loads the nested AI workstation graph and ranks GPU candidates from editable requirements.'
