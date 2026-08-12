import { createNode, oneOf } from './dagCore.ts'
import { createDagNodeIndex, dagNodeId, describeDagEnvironment } from './dagEnvironment.ts'

const emptyObjectSchema = { type: 'object', additionalProperties: false } as const

export const testDagEnvironmentSeparatesSourcesFromPotentialLeaves = () => {
  const designLeaf = createNode({
    name: 'designLeaf',
    version: 1,
    localParams: emptyObjectSchema,
    outputSchema: { type: 'number' } as const,
    run: () => 1,
  })
  const unusedAlternative = createNode({
    name: 'unusedAlternative',
    version: 1,
    localParams: emptyObjectSchema,
    outputSchema: { type: 'number' } as const,
    run: () => 2,
  })
  const weather = createNode({
    name: 'weather',
    version: 1,
    effect: 'source',
    hiddenInputs: { location: designLeaf },
    localParams: emptyObjectSchema,
    outputSchema: { type: 'number' } as const,
    run: async (_, use) => await use.location(),
  })
  const root = createNode({
    name: 'root',
    version: 1,
    exposedInputs: { weather: oneOf([weather, unusedAlternative]) },
    localParams: emptyObjectSchema,
    outputSchema: { type: 'number' } as const,
    run: async (_, use) => await use.weather(),
  })

  const environment = describeDagEnvironment(root)
  if (environment.sources.map((node) => node.name).join(',') !== 'weather') {
    throw new Error('Expected the non-leaf source to be included exactly once.')
  }
  const potentialNames = environment.potentialLeaves
    .map((node) => node.name)
    .sort()
    .join(',')
  if (potentialNames !== 'designLeaf,unusedAlternative') {
    throw new Error(`Expected pure upstream leaves, received ${potentialNames}.`)
  }
  const weatherConsumers = environment.downstreamByNode.get(weather)?.map((node) => node.name)
  if (weatherConsumers?.join(',') !== 'root') {
    throw new Error('Expected downstream lineage from weather to root.')
  }
  return {
    sources: environment.sources.map((node) => node.name),
    potentialLeaves: environment.potentialLeaves.map((node) => node.name),
  }
}

testDagEnvironmentSeparatesSourcesFromPotentialLeaves.description =
  'Finds declared sources anywhere in a selected DAG closure and pure leaves as potential origins.'

export const testDagEnvironmentIndexesMultipleRuntimeRoots = () => {
  const input = createNode({
    name: 'runtime-input',
    contentHash: 'sha256:input',
    version: 1,
    localParams: emptyObjectSchema,
    outputSchema: emptyObjectSchema,
    run: () => ({}),
  })
  const firstOutput = createNode({
    name: 'first-output',
    contentHash: 'sha256:first',
    version: 1,
    hiddenInputs: { input },
    localParams: emptyObjectSchema,
    outputSchema: emptyObjectSchema,
    run: () => ({}),
  })
  const secondOutput = createNode({
    name: 'second-output',
    contentHash: 'sha256:second',
    version: 1,
    hiddenInputs: { input },
    localParams: emptyObjectSchema,
    outputSchema: emptyObjectSchema,
    run: () => ({}),
  })

  const index = createDagNodeIndex({ firstOutput, secondOutput })
  if (
    index[dagNodeId(input)]?.node !== input ||
    index[dagNodeId(firstOutput)]?.node !== firstOutput ||
    index[dagNodeId(secondOutput)]?.node !== secondOutput ||
    Object.keys(index).length !== 3
  ) {
    throw new Error('Expected the runtime index to deduplicate every node across output closures.')
  }
}

testDagEnvironmentIndexesMultipleRuntimeRoots.description =
  'Indexes executable nodes by immutable identity across multiple DAG roots.'
