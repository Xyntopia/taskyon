import {
  compileDagNodeRecordGraph,
  savedStoredNodesToRecordGraph,
} from '@taskyon/comp-dag/dagNodeRecordGraph'
import { createAiWorkstationExample } from '../examples/aiWorkstationExample'

type WorkstationResult = {
  recommendation: {
    id: string
    viable: boolean
    score: number
    rejectedReasons: string[]
  }
  requirements: { budgetUsd: number; model: string }
  modelEstimate: { requiredVramGb: number }
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

const nodeRepositoryReader = async (path: string): Promise<string> => {
  const { readFile } = await import('node:fs/promises')
  const repositoryUrl = new URL(
    '../../../../public/design-repositories/ai-workstation/',
    import.meta.url,
  )
  return await readFile(new URL(path, repositoryUrl), 'utf8')
}

export const testAiWorkstationGraphEvaluatesStructuralConfigurations = async () => {
  if (typeof window !== 'undefined') {
    return {
      skipped: true,
      reason: 'The generated workstation compiler diagnostic requires Node.',
    }
  }

  const example = await createAiWorkstationExample(
    typeof window === 'undefined' ? { readText: nodeRepositoryReader } : undefined,
  )
  const graph = savedStoredNodesToRecordGraph(
    Object.fromEntries(example.nodes.map((node) => [node.hash, node])),
  )
  const compiled = compileDagNodeRecordGraph({ graph, rootHash: example.rootHash })
  const root = compiled[example.rootHash]
  assert(root, 'Expected generated workstation root to compile')

  const initial = await root.call({ requirements: {}, candidate: { itemIndex: 0 } }).run()
  const initialValue = initial.value as WorkstationResult
  assert(initialValue.recommendation.id === 'rtx-3090-value', 'Expected selected configuration')
  assert(initialValue.requirements.model === 'qwen2.5-32b', 'Expected default workload scenario')
  assert(
    initialValue.modelEstimate.requiredVramGb > 20,
    'Expected model memory to be derived from model metadata and scenario inputs',
  )

  const study = await root.call({ requirements: {}, candidate: {} }).study({
    mode: 'optimize',
    objective: { path: 'recommendation.score', direction: 'max' },
    rngSeed: 1,
  })
  const ids = study.rows.map((row) => (row as WorkstationResult).recommendation.id)
  assert(study.rows.length === 6, 'Expected one study row per workstation configuration')
  assert(new Set(ids).size === 6, 'Expected structurally distinct configuration rows')
  assert(study.best, 'Expected a best workstation result')
  const best = study.best as WorkstationResult
  assert(
    best.recommendation.viable,
    `Expected a feasible workstation, received ${JSON.stringify(best.recommendation)}`,
  )
  const mainInvocationId = example.revision.invocations.main
  const mainInvocation = mainInvocationId ? example.invocations[mainInvocationId] : undefined
  assert(mainInvocation, 'Expected the project revision to select its main invocation')
  assert(
    mainInvocation.variables['requirements.budgetUsd']?.kind === 'sweep',
    'Expected budget to be represented by the canonical invocation domain',
  )
  assert(
    mainInvocation.inputs.candidate?.strategy?.id === 'sequential',
    'Expected structural candidate planning to be part of the invocation',
  )

  return {
    rootHash: example.rootHash,
    rows: study.rows.length,
    candidateIds: ids,
    best: best.recommendation,
  }
}

testAiWorkstationGraphEvaluatesStructuralConfigurations.description =
  'Loads the public workstation repository and evaluates its revision-owned configurations.'
