import { createNode, type DagQuerySelection } from './dagCore.ts'
import { compileDagNodeRecordGraph } from './dagNodeRecordGraph.ts'
import { defineDagNodeRecord } from './dagNodeRecord.ts'
import { objectSchema, parseSchema } from './dagSchema.ts'

const assert: (condition: unknown, message: string) => asserts condition = (condition, message) => {
  if (!condition) throw new Error(message)
}

const xSchema = objectSchema({
  properties: { x: { type: 'number' } },
  required: ['x'],
})
const valueSchema = objectSchema({
  properties: { value: { type: 'number' } },
  required: ['value'],
})
const scoreSchema = objectSchema({
  properties: { score: { type: 'number' } },
  required: ['score'],
})
const doubledSchema = objectSchema({
  properties: { doubled: { type: 'number' } },
  required: ['doubled'],
})
const countSchema = objectSchema({
  properties: { count: { type: 'number' } },
  required: ['count'],
})

export const testNodeSliceUsesStudyExecutionForQueries = async () => {
  const source = createNode({
    name: 'node_slice_query_source',
    version: 1,
    localParams: objectSchema({
      properties: { scale: { type: 'number' }, x: { type: 'number' } },
      required: ['scale', 'x'],
    }),
    outputSchema: objectSchema({
      properties: { score: { type: 'number' }, x: { type: 'number' } },
      required: ['score', 'x'],
    }),
    run: ({ x, scale }: { x: number; scale: number }) => ({ x, score: x * scale }),
  })

  const query = source.call({ x: 0, scale: 0 }).slice({
    x: { range: [1, 3], step: 1 },
    scale: { values: [10, 20] },
  })
  const collected = await query.collect()
  const mean = await query.mean('score')
  const best = await query.argmax('score')

  assert(collected.rows.length === 6, 'Expected the slice to evaluate the Cartesian product')
  assert(mean === 30, `Expected mean score 30, received ${String(mean)}`)
  assert(best?.row.score === 60, 'Expected argmax to return the highest-scoring row')
  assert(best.rowKey.x === 3, 'Expected argmax to preserve the selected parameter key')
  assert(best.rowKey.scale === 20, 'Expected argmax to preserve every selected parameter key')

  return { best, mean, rows: collected.rows.length }
}

testNodeSliceUsesStudyExecutionForQueries.description =
  'Uses semantic node slices through the existing study execution path.'

export const testNodeSliceMapsAndAppliesStoredGraphInputs = async () => {
  const source = createNode({
    name: 'node_slice_map_source',
    version: 1,
    localParams: xSchema,
    outputSchema: valueSchema,
    run: ({ x }: { x: number }) => ({ value: x }),
  })
  const transform = createNode({
    name: 'node_slice_map_transform',
    version: 1,
    localParams: valueSchema,
    outputSchema: doubledSchema,
    run: ({ value }: { value: number }) => ({ doubled: value * 2 }),
  })
  const summarize = createNode({
    name: 'node_slice_apply_summary',
    version: 1,
    localParams: objectSchema({
      properties: { rows: { items: {}, type: 'array' } },
      required: ['rows'],
    }),
    outputSchema: countSchema,
    run: ({ rows }: { rows: unknown[] }) => ({ count: rows.length }),
  })
  const root = createNode({
    name: 'node_slice_map_root',
    version: 1,
    hiddenInputs: { source, summarize, transform },
    outputSchema: objectSchema({
      properties: {
        count: { type: 'number' },
        doubled: { items: doubledSchema, type: 'array' },
      },
      required: ['count', 'doubled'],
    }),
    run: async (_params, use) => {
      const slice = use.source.slice({ x: { values: [1, 2, 3] } })
      const mapped = await slice.map(use.transform, {
        value: { path: 'value', source: 'row' },
      })
      const summary = await slice.apply(use.summarize, {
        rows: { source: 'rows' },
      })
      return { count: summary.count, doubled: mapped.rows }
    },
  })

  const result = await root.call({}).run()

  assert(result.value.count === 3, 'Expected apply() to receive the complete evaluation set')
  assert(
    result.value.doubled.map(({ doubled }) => doubled).join(',') === '2,4,6',
    'Expected map() to run the declared transform node once per row',
  )
  return result.value
}

testNodeSliceMapsAndAppliesStoredGraphInputs.description =
  'Maps rows and applies whole result sets through declared DAG inputs.'

export const testStoredNodeSliceRunsThroughSandboxProtocol = async () => {
  const source = await defineDagNodeRecord({
    formatVersion: 2,
    label: 'Stored slice source',
    localName: 'stored_slice_source',
    localParamsSchema: xSchema,
    outputSchema: scoreSchema,
    runSource: `({ params }) => ({ score: params.x * 2 })`,
    runCode: `({ params }) => ({ score: params.x * 2 })`,
    version: 1,
  })
  const root = await defineDagNodeRecord({
    formatVersion: 2,
    inputs: {
      source: { nodeId: source.id, role: 'internal' },
    },
    label: 'Stored slice root',
    localName: 'stored_slice_root',
    localParamsSchema: {},
    outputSchema: objectSchema({
      properties: {
        best: {
          additionalProperties: false,
          properties: {
            index: { type: 'number' },
            objectiveValue: { type: 'number' },
            row: scoreSchema,
            rowKey: { type: 'object' },
          },
          required: ['index', 'objectiveValue', 'row', 'rowKey'],
          type: 'object',
        },
      },
      required: ['best'],
    }),
    runSource: `async ({ use }) => ({
      best: await use.source
        .slice({ x: { range: [2, 4], step: 1 } })
        .argmax('score'),
    })`,
    runCode: `async ({ use }) => ({
      best: await use.source
        .slice({ x: { range: [2, 4], step: 1 } })
        .argmax('score'),
    })`,
    version: 1,
  })
  const graph = compileDagNodeRecordGraph({
    graph: { [root.id]: root, [source.id]: source },
    rootHash: root.id,
  })
  const compiledRoot = graph[root.id]
  assert(compiledRoot, 'Expected the stored slice graph to compile')

  const result = await compiledRoot.call({}).run()
  const best = parseSchema<{ best: DagQuerySelection<{ score: number }> }>(
    root.outputSchema,
    result.value,
  ).best

  assert(best.row.score === 8, 'Expected the sandbox query to execute the stored source slice')
  assert(best.rowKey.x === 4, 'Expected the sandbox query to preserve the selected parameter')
  return best
}

testStoredNodeSliceRunsThroughSandboxProtocol.description =
  'Executes stored node slice queries through the sandbox capability protocol.'
