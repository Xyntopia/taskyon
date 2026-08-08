import type { SerializedRemoteError } from '../remoteError.ts'

export type SandboxSerializedError = SerializedRemoteError

export type SandboxReusePolicy =
  | { mode: 'disposable' }
  | { mode: 'affinity'; key: string }
  | { mode: 'immutable'; contentId: string }

export interface ExecuteInWorkerSandboxOptions {
  id: string
  code: string
  sourceURL?: string
  stopSignal: AbortSignal
  browserRuntime?: 'iframe' | 'worker'
  nodeRuntime?: 'node' | 'deno'
  maxExecutionMs?: number
  maxOldSpaceSizeMb?: number
  maxOutputBytes?: number
  reuse?: SandboxReusePolicy
}

export type SandboxExecuteRequest = {
  kind: 'execute'
  requestId: string
  code?: string | undefined
  moduleId?: string | undefined
  args: unknown[]
  sourceURL: string
  channelId?: string | undefined
}

export type SandboxInstallRequest = {
  kind: 'install'
  requestId: string
  moduleId: string
  code: string
  sourceURL: string
}

export type SandboxOpenChannelRequest = {
  kind: 'open-channel'
  requestId: string
  channelId: string
  installerCode: string
  args: unknown[]
  sourceURL: string
}

export type SandboxChannelMessage = {
  kind: 'channel-message'
  channelId: string
  payload: unknown
}

export type SandboxChannelClose = {
  kind: 'channel-close'
  channelId: string
}

export type SandboxCancelRequest = {
  kind: 'cancel'
  requestId: string
  reason: string
}

export type SandboxExecutionResult = {
  kind: 'result'
  requestId: string
  result: unknown
}

export type SandboxExecutionError = {
  kind: 'error'
  requestId: string
  error: SandboxSerializedError
}

export type SandboxExecutionCancelled = {
  kind: 'cancelled'
  requestId: string
  reason: string
}

export type SandboxRuntimeFailure = {
  kind: 'runtime-error'
  error: SandboxSerializedError
}

export type SandboxHostToRuntimeMessage =
  | SandboxExecuteRequest
  | SandboxInstallRequest
  | SandboxOpenChannelRequest
  | SandboxChannelMessage
  | SandboxChannelClose
  | SandboxCancelRequest

export type SandboxRuntimeToHostMessage =
  | SandboxExecutionResult
  | SandboxExecutionError
  | SandboxExecutionCancelled
  | SandboxRuntimeFailure
  | SandboxChannelMessage
  | SandboxChannelClose

export type SandboxChannelCapability = {
  readonly channelId: string
}

export type SandboxExecuteOptions = {
  signal?: AbortSignal | undefined
  sourceURL?: string | undefined
  channel?: SandboxChannelCapability | undefined
  maxExecutionMs?: number | undefined
  maxOutputBytes?: number | undefined
}

export type SandboxRuntimeKind = 'iframe' | 'worker' | 'node' | 'deno'
