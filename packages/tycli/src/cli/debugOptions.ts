import { readdir, unlink } from 'node:fs/promises'
import { join } from 'node:path'

export const resolveCliDebugConfiguration = (
  argv: readonly string[],
  environmentPrefix: string,
  environment: Readonly<Record<string, string | undefined>>,
  logDir: string,
) => {
  const debugLogsEnabled =
    argv.includes('--debug') || environment[`${environmentPrefix}_DEBUG`] === '1'
  const explicitTraceDir = environment[`${environmentPrefix}_CHAT_COMPLETION_TRACE_DIR`]?.trim()
  const traceDir = explicitTraceDir || (debugLogsEnabled ? logDir : undefined)
  const label = environment[`${environmentPrefix}_CHAT_COMPLETION_TRACE_LABEL`]?.trim()

  return {
    debugLogsEnabled,
    chatCompletionTrace: traceDir
      ? {
          dir: traceDir,
          ...(label ? { label } : {}),
        }
      : undefined,
  }
}

export const isCliDebugArtifactFile = (name: string) =>
  name.endsWith('.log') || /^\d+_.+_record\.json$/.test(name)

export const cleanCliDebugArtifacts = async (logDir: string) => {
  let entries
  try {
    entries = await readdir(logDir, { withFileTypes: true })
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
      return 0
    }
    throw error
  }

  const logFiles = entries.filter((entry) => entry.isFile() && isCliDebugArtifactFile(entry.name))
  await Promise.all(logFiles.map((entry) => unlink(join(logDir, entry.name))))
  return logFiles.length
}
