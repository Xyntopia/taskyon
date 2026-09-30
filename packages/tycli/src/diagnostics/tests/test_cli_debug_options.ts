import { mkdtemp, readFile, readdir, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  cleanCliDebugArtifacts,
  isCliDebugArtifactFile,
  resolveCliDebugConfiguration,
} from '../../cli/debugOptions'
import { createCliChatCompletionTraceWriter } from '../../cli/chatCompletionTraceWriter'

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
  assert(
    configuration.chatCompletionTrace.captureResponse === false,
    'Routine debug logging must not retain the full provider response',
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
  assert(
    configuration.chatCompletionTrace.captureResponse === true,
    'An explicit trace directory should capture the provider response',
  )
}

testCliDebugConfigurationKeepsExplicitTraceOverrides.description =
  'Preserves explicit trace-directory and trace-label overrides for isolated diagnostic runs.'

export const testCliTraceDirFlagCapturesResponsesAndOverridesEnvironment = () => {
  for (const args of [['--trace-dir', '/tmp/flag-trace'], ['--trace-dir=/tmp/flag-trace']]) {
    const configuration = resolveCliDebugConfiguration(
      args,
      'TYCLI',
      { TYCLI_CHAT_COMPLETION_TRACE_DIR: '/tmp/environment-trace' },
      '/var/log/tycli',
    )

    assert(!configuration.debugLogsEnabled, 'Tracing must not enable verbose runtime logging')
    assert(
      configuration.chatCompletionTrace?.dir === '/tmp/flag-trace',
      'The explicit CLI flag should take precedence over the environment',
    )
    assert(
      configuration.chatCompletionTrace.captureResponse,
      'The explicit CLI flag should capture the provider response',
    )
  }
}

export const testCliTraceDirFlagRequiresAPath = () => {
  for (const args of [['--trace-dir'], ['--trace-dir', '--online'], ['--trace-dir=']]) {
    let error: unknown
    try {
      resolveCliDebugConfiguration(args, 'TYCLI', {}, '/var/log/tycli')
    } catch (caught) {
      error = caught
    }
    assert(error instanceof Error, `Expected ${args.join(' ')} to reject a missing path`)
  }
}

export const testCliTraceWriterSavesResponseWithPrivatePermissions = async () => {
  const traceDir = await mkdtemp(join(tmpdir(), 'tycli-trace-diagnostic-'))
  await createCliChatCompletionTraceWriter(traceDir, 'diagnostic', true).write({
    taskId: 'synthetic-task',
    providerRequest: {
      provider: 'synthetic',
      model: 'synthetic-model',
      taskId: 'synthetic-task',
      attempts: [],
    },
    providerResponse: {
      rawChunks: [{ usage: { server_tool_use_details: { web_search_requests: 1 } } }],
      messages: [{ role: 'assistant', content: 'Synthetic response' }],
    },
  })
  const files = await readdir(traceDir)
  assert(files.length === 1, 'Expected one trace record')
  assert(files[0]?.includes('diagnostic'), 'Expected the diagnostic trace label')
  const tracePath = join(traceDir, files[0]!)
  const record = JSON.parse(await readFile(tracePath, 'utf8')) as {
    providerResponse?: { rawChunks: unknown[]; messages: unknown[] }
  }
  assert(record.providerResponse?.rawChunks.length === 1, 'Expected raw response metadata')
  assert(record.providerResponse.messages.length === 1, 'Expected parsed response messages')
  assert(((await stat(tracePath)).mode & 0o077) === 0, 'Trace files must be owner-only')
}

export const testCliDebugWriterOmitsFullProviderResponse = async () => {
  const traceDir = await mkdtemp(join(tmpdir(), 'tycli-debug-trace-diagnostic-'))
  await createCliChatCompletionTraceWriter(traceDir).write({
    taskId: 'synthetic-task',
    providerRequest: {
      provider: 'synthetic',
      model: 'synthetic-model',
      taskId: 'synthetic-task',
      attempts: [],
    },
    providerResponse: { rawChunks: ['synthetic private output'] },
  })
  const files = await readdir(traceDir)
  const record = JSON.parse(await readFile(join(traceDir, files[0]!), 'utf8')) as {
    providerResponse?: unknown
  }
  assert(record.providerResponse === undefined, 'Routine debug traces should remain request-only')
}

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
