import {
  diagnosticsRunLevels,
  filterDiagnosticsThroughLevel,
  getDiagnosticsRunLevel,
  parseDiagnosticsRunLevel,
} from './diagnosticsLevels'
import type { TaskyonTestFn } from './diagnosticsRunner'

function assert(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

export const testDiagnosticsRunLevelsKeepReleaseChecksBelowQuality = () => {
  const check: TaskyonTestFn = () => undefined
  const tests = {
    'Test Combined Workflow Requires Search Before Final Computation': check,
    'Test Simple Greeting Conversation Uses Normal Taskyon Flow': check,
    'Test Ideal Workflow Matrix With Luna And Glm': check,
    'Test Document Retrieval Stores Official Federal Rules Pdf': check,
    'Test Cli Creates And Runs Dag Graph Project': check,
    'Test Cli Compares Dag Graph Workstation Options': check,
    'Test Gpt6 Luna Prompt Cache Reuses Increasing Tree Branches': check,
  }

  assert(
    getDiagnosticsRunLevel(
      'Test Combined Workflow Requires Search Before Final Computation',
      check,
    ) === 1,
    'The deterministic workflow guard should be available in the quickest run',
  )
  assert(
    getDiagnosticsRunLevel('Test Simple Greeting Conversation Uses Normal Taskyon Flow', check) ===
      3,
    'A single live model workflow belongs in release diagnostics',
  )
  const quick = Object.keys(filterDiagnosticsThroughLevel(tests, 1))
  assert(quick.length === 1, 'The quick run should include only its curated smoke checks')
  const selected = Object.keys(filterDiagnosticsThroughLevel(tests, 3))
  assert(selected.length === 7, 'The release run should include the PDF retrieval checks')
  assert(
    selected.includes('Test Document Retrieval Stores Official Federal Rules Pdf'),
    'The release run should verify retrieval and storage of the official PDF',
  )
  assert(
    getDiagnosticsRunLevel('Test Document Retrieval Stores Official Federal Rules Pdf', check) ===
      3,
    'The PDF retrieval diagnostic should run at the release level',
  )
  assert(
    Object.keys(filterDiagnosticsThroughLevel(tests, 4)).length === 7,
    'The quality run should retain the cumulative release checks',
  )
  assert(
    selected.includes('Test Ideal Workflow Matrix With Luna And Glm'),
    'The two-model workflow matrix must be part of the release run',
  )
  assert(
    getDiagnosticsRunLevel('Test Cli Creates And Runs Dag Graph Project', check) === 3 &&
      getDiagnosticsRunLevel('Test Cli Compares Dag Graph Workstation Options', check) === 3,
    'Scripted project checks have objective outcomes and belong in level 3',
  )
}

export const testDiagnosticsRunLevelsClassifyUnmarkedAndCostlyChecks = () => {
  const plain: TaskyonTestFn = () => undefined
  const longRun: TaskyonTestFn = () => undefined
  longRun.requiresLongRun = true
  const experimental: TaskyonTestFn = () => undefined
  experimental.experimental = true

  assert(
    getDiagnosticsRunLevel('Unknown Local Check', plain) === 2,
    'Unknown checks need a safe default',
  )
  assert(
    getDiagnosticsRunLevel('Unknown Long Check', longRun) === 3,
    'Long checks belong in release diagnostics',
  )
  assert(
    getDiagnosticsRunLevel('Unknown Experimental Check', experimental) === 3,
    'Objective experimental checks belong in release diagnostics',
  )
  const slower: TaskyonTestFn = () => undefined
  slower.timeoutMs = 60_000
  assert(
    getDiagnosticsRunLevel('Unknown Slower Check', slower) === 3,
    'Tests with a large timeout must not enter the per-test-fast level',
  )
  assert(
    diagnosticsRunLevels.map(({ value }) => value).join(',') === '1,2,3,4',
    'Only the four cumulative levels should be available',
  )
  assert(parseDiagnosticsRunLevel('4') === 4, 'The CLI should accept a whole-number level')
  for (const invalid of ['0', '5', '2.5', '']) {
    let rejected = false
    try {
      parseDiagnosticsRunLevel(invalid)
    } catch {
      rejected = true
    }
    assert(rejected, `Invalid run level ${JSON.stringify(invalid)} should be rejected`)
  }
}
