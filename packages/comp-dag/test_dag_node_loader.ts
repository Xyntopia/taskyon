import { SELF_HASH_PLACEHOLDER } from './dagNodeIdentity.ts'
import { hashStoredGraphNodeSource, normalizeStoredGraphNodeSource } from './dagNodeLoader.ts'

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

const nodeBody = `{
  formatVersion: 2,
  id: '${SELF_HASH_PLACEHOLDER}',
  localName: 'standalone_node',
  label: 'Standalone Node',
  version: 1,
  localParamsSchema: {},
  outputSchema: {},
  inputs: {},
  run: () => ({ value: 1 }),
}`

export const testStoredDagNodeNormalizationEmitsStandaloneSource = async () => {
  const legacySource = `import type { StoredDagNodeModule } from '@taskyon/comp-dag/dagNodeLoader'

export default ${nodeBody} satisfies StoredDagNodeModule
`
  const standaloneSource = `export default ${nodeBody}\n`
  const [legacy, legacyHash, standaloneHash] = await Promise.all([
    normalizeStoredGraphNodeSource(legacySource),
    hashStoredGraphNodeSource(legacySource),
    hashStoredGraphNodeSource(standaloneSource),
  ])

  assert(
    !legacy.source.includes('StoredDagNodeModule'),
    'Expected normalized stored-node source to omit the application type import',
  )
  assert(
    legacy.source.startsWith('export default {'),
    'Expected normalized stored-node source to be a standalone default-exported record',
  )
  assert(
    legacyHash === standaloneHash,
    'Expected removing the TypeScript wrapper to preserve semantic node identity',
  )

  return { hash: legacyHash, source: legacy.source }
}

testStoredDagNodeNormalizationEmitsStandaloneSource.description =
  'Normalizes stored design-graph nodes into standalone source without application imports.'
