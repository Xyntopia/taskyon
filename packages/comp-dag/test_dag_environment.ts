import { createNode, oneOf } from './dagCore.ts'
import { describeDagEnvironment } from './dagEnvironment.ts'

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
