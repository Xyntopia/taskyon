import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createAiWorkstationExample } from '@taskyon/taskyon'
import { createDagGraphProjectTool } from '../../tools/dagGraphProjectTool'

type WorkstationResult = {
  recommendation: { id: string; viable: boolean; score: number }
  requirements: { budgetUsd: number; model: string }
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

const parseResult = (value: unknown): WorkstationResult => {
  assert(value !== null && typeof value === 'object', 'Expected workstation result object')
  const result = value as {
    recommendation?: unknown
    requirements?: unknown
  }
  assert(
    result.recommendation !== null &&
      typeof result.recommendation === 'object' &&
      'id' in result.recommendation &&
      typeof result.recommendation.id === 'string' &&
      'viable' in result.recommendation &&
      typeof result.recommendation.viable === 'boolean' &&
      'score' in result.recommendation &&
      typeof result.recommendation.score === 'number',
    'Expected typed recommendation',
  )
  assert(
    result.requirements !== null &&
      typeof result.requirements === 'object' &&
      'budgetUsd' in result.requirements &&
      typeof result.requirements.budgetUsd === 'number' &&
      'model' in result.requirements &&
      typeof result.requirements.model === 'string',
    'Expected typed requirements',
  )
  return {
    recommendation: {
      id: result.recommendation.id,
      viable: result.recommendation.viable,
      score: result.recommendation.score,
    },
    requirements: {
      budgetUsd: result.requirements.budgetUsd,
      model: result.requirements.model,
    },
  }
}

export const testDagGraphProjectToolRunsDeterministicWorkstationWorkflow = async () => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), 'taskyon-dag-project-diagnostic-'))
  const projectId = 'ai-workstation'
  const artifactRoot = 'taskyon-artifacts'
  try {
    const repositoryUrl = new URL(
      '../../../../../public/design-repositories/ai-workstation/',
      import.meta.url,
    )
    const example = await createAiWorkstationExample({
      readText: async (path) => await readFile(new URL(path, repositoryUrl), 'utf8'),
    })
    const tool = createDagGraphProjectTool({ workspaceRoot })
    for (const node of example.nodes) {
      const created = await tool.function({
        action: 'createNode',
        projectId,
        nodeSource: node.file.source,
        artifactRoot,
      })
      assert(created.type === 'dagGraphNodeCreated', 'Expected node creation result')
      assert(created.rootHash === node.hash, 'Expected content-addressed node hash')
    }

    const createdRevision = await tool.function({
      action: 'createRevision',
      projectId,
      roots: { main: example.rootHash },
      designSpace: example.designSpace,
      message: 'Evidence-backed workstation design',
      artifactRoot,
    })
    assert(createdRevision.type === 'designRevisionCreated', 'Expected initial design revision')
    await tool.function({
      action: 'advanceRef',
      projectId,
      refName: 'main',
      revisionId: createdRevision.revision.id,
      artifactRoot,
    })

    const run = await tool.function({
      action: 'runRoot',
      projectId,
      rootName: 'main',
      revisionId: createdRevision.revision.id,
      params: { requirements: {}, candidate: { itemIndex: 0 } },
      artifactRoot,
    })
    assert(run.type === 'dagGraphRunResult', 'Expected a persisted root run')
    const initial = parseResult(run.value)
    assert(initial.recommendation.id === 'rtx-3090-value', 'Expected selected structural design')

    const study = await tool.function({
      action: 'studyRoot',
      projectId,
      rootName: 'main',
      revisionId: createdRevision.revision.id,
      params: { requirements: {}, candidate: {} },
      study: {
        mode: 'optimize',
        objective: { path: 'recommendation.score', direction: 'max' },
        rngSeed: 1,
      },
      artifactRoot,
    })
    assert(study.type === 'dagGraphStudyResult', 'Expected persisted workstation study')
    assert(study.rows.length === 6, 'Expected six structural workstation designs')
    const ids = study.rows.map((row) => parseResult(row).recommendation.id)
    assert(new Set(ids).size === 6, 'Expected each catalog design exactly once')
    assert(study.plan.variableRuns === 1, 'Expected requirements to remain fixed during the study')
    assert(study.best, 'Expected a best feasible design')
    const best = parseResult(study.best)
    assert(best.recommendation.viable, 'Expected optimization to select a feasible design')

    const persistedNodes = await readdir(
      join(workspaceRoot, artifactRoot, 'dag-graphs', projectId, 'nodes'),
    )
    assert(persistedNodes.length === 5, 'Expected the five-node workstation closure')
    return {
      revisionId: createdRevision.revision.id,
      rootHash: example.rootHash,
      studyRows: study.rows.length,
      candidateIds: ids,
      best: best.recommendation,
    }
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true })
  }
}

testDagGraphProjectToolRunsDeterministicWorkstationWorkflow.description =
  'Creates, revisions, runs, and studies the persisted structural AI workstation graph.'
