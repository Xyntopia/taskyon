import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  cleanCliDebugArtifacts,
  isCliDebugArtifactFile,
  resolveCliDebugConfiguration,
} from '../../cli/debugOptions'

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

export const testCliDebugOptionEnablesRuntimeAndRequestTracing = () => {
  const configuration = resolveCliDebugConfiguration(['--debug'], 'TYCLI', {}, '/var/log/tycli')

  assert(configuration.debugLogsEnabled, 'Expected --debug to enable runtime debug logging')
  assert(
    configuration.chatCompletionTrace?.dir === '/var/log/tycli',
    'Expected --debug to write chatCompletion traces beside runtime logs',
  )
}

testCliDebugOptionEnablesRuntimeAndRequestTracing.description =
  'Enables runtime diagnostics and chatCompletion provider-request tracing with one CLI option.'

export const testCliDebugConfigurationKeepsExplicitTraceOverrides = () => {
  const configuration = resolveCliDebugConfiguration(
    [],
    'TYCLI',
    {
      TYCLI_CHAT_COMPLETION_TRACE_DIR: '/tmp/isolated-trace',
      TYCLI_CHAT_COMPLETION_TRACE_LABEL: 'diagnostic',
    },
    '/var/log/tycli',
  )

  assert(!configuration.debugLogsEnabled, 'Expected tracing alone not to enable runtime debug logs')
  assert(
    configuration.chatCompletionTrace?.dir === '/tmp/isolated-trace',
    'Expected the explicit trace directory to remain an override',
  )
  assert(
    configuration.chatCompletionTrace?.label === 'diagnostic',
    'Expected the explicit trace label to be preserved',
  )
}

testCliDebugConfigurationKeepsExplicitTraceOverrides.description =
  'Preserves explicit trace-directory and trace-label overrides for isolated diagnostic runs.'

export const testCliLogCleanupRecognizesOnlyOwnedDebugArtifacts = async () => {
  const logDir = await mkdtemp(join(tmpdir(), 'tycli-debug-cleanup-diagnostic-'))
  await writeFile(join(logDir, 'tycli_20260820.log'), 'runtime\n', 'utf8')
  await writeFile(join(logDir, '0001_directory-count_task_record.json'), '{}\n', 'utf8')
  await writeFile(join(logDir, 'notes.json'), '{}\n', 'utf8')
  await writeFile(join(logDir, 'task_record.json'), '{}\n', 'utf8')

  const removed = await cleanCliDebugArtifacts(logDir)
  assert(removed === 2, 'Expected runtime logs and traces to be removed')
  assert(!isCliDebugArtifactFile('notes.json'), 'Expected unrelated JSON files to be preserved')
  assert(
    (await readFile(join(logDir, 'notes.json'), 'utf8')) === '{}\n',
    'Expected unrelated JSON file to remain on disk',
  )
  assert(
    !isCliDebugArtifactFile('task_record.json'),
    'Expected unsequenced JSON files to be preserved',
  )
}

testCliLogCleanupRecognizesOnlyOwnedDebugArtifacts.description =
  'Limits --clean-logs cleanup to runtime logs and sequenced chatCompletion trace records.'
