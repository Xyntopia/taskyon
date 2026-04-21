import { ref } from 'vue'

export type LogLevel = 'info' | 'warn' | 'error'

export type LogEntry = {
  atMs: number
  level: LogLevel
  message: string
  data?: unknown
}

export type UnifiedLogEntry = LogEntry & {
  id: number
  source: string
}

const modelRunLogs = ref<LogEntry[]>([])
const unifiedRunLogs = ref<UnifiedLogEntry[]>([])
let unifiedLogSeq = 0

const appendLog = (source: string, message: string, data?: unknown, level: LogLevel = 'info') => {
  unifiedRunLogs.value.push({
    id: (unifiedLogSeq += 1),
    atMs: Date.now(),
    level,
    source,
    message,
    data,
  })

  if (unifiedRunLogs.value.length > 1200) {
    unifiedRunLogs.value.splice(0, unifiedRunLogs.value.length - 1200)
  }
}

const appendModelRunLog = (message: string, data?: unknown, level: LogLevel = 'info') => {
  modelRunLogs.value.push({
    atMs: Date.now(),
    level,
    message,
    data,
  })

  appendLog('model', message, data, level)

  if (modelRunLogs.value.length > 300) {
    modelRunLogs.value.splice(0, modelRunLogs.value.length - 300)
  }
}

const appendLogToList = (
  logs: LogEntry[],
  source: string,
  message: string,
  data?: unknown,
  level: LogLevel = 'info',
) => {
  logs.push({
    atMs: Date.now(),
    level,
    message,
    data,
  })

  appendLog(source, message, data, level)

  if (logs.length > 200) {
    logs.splice(0, logs.length - 200)
  }
}

const appendUiLog = (message: string, data?: unknown, level: LogLevel = 'info') => {
  appendLog('ui', message, data, level)
}

const appendChartsLog = (message: string, data?: unknown, level: LogLevel = 'error') => {
  appendLog('charts', message, data, level)
}

const clearLogs = () => {
  modelRunLogs.value = []
  unifiedRunLogs.value = []
}

export const useSharedRunLogs = () => ({
  modelRunLogs,
  unifiedRunLogs,
  appendLog,
  appendLogToList,
  appendModelRunLog,
  appendUiLog,
  appendChartsLog,
  clearLogs,
})

