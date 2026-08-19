export type CliTaskState = 'idle' | 'processing' | 'finished'

export type CliFooterStatus = {
  provider: string
  model: string
  taskState: CliTaskState
  activeTasks: number
  cost?: string
  costIncomplete?: boolean
  cachePercent?: number | null
  logPath?: string
  conversationPath?: string
}

export type CliFooter = {
  beforePrompt: () => void
  setStatus: (status: CliFooterStatus) => void
  restore: () => void
}

export const noopCliFooter = (): CliFooter => ({
  beforePrompt: () => {},
  setStatus: () => {},
  restore: () => {},
})
