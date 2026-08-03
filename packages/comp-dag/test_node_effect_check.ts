import { analyzeDagNodeEffectSource, assertDagNodeEffectSource } from './dagNodeEffectCheck.ts'

export const testPureNodeAmbientIoIsRejected = () => {
  const source = `async () => await fetch('https://example.test/data')`
  const issues = analyzeDagNodeEffectSource('pure', source)
  if (!issues.some(({ severity, capability }) => severity === 'block' && capability === 'fetch')) {
    throw new Error('Expected direct fetch to block a pure node.')
  }
  try {
    assertDagNodeEffectSource('pure', source)
  } catch {
    assertDagNodeEffectSource('source', source)
    return { issues }
  }
  throw new Error('Expected pure ambient I/O assertion to fail.')
}

testPureNodeAmbientIoIsRejected.description =
  'Blocks high-confidence ambient I/O in pure nodes while permitting declared source nodes.'

export const testPureNodeUncertainGlobalsWarn = () => {
  const issues = analyzeDagNodeEffectSource('pure', `() => ({ at: Date.now() })`)
  if (!issues.some(({ severity, capability }) => severity === 'warn' && capability === 'clock')) {
    throw new Error('Expected ambient clock use to warn.')
  }
  return { issues }
}

testPureNodeUncertainGlobalsWarn.description =
  'Warns rather than blocks when a pure node may depend on an ambient clock.'
