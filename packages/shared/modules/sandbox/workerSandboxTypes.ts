export type WorkerSandboxRpcHandler = (...args: unknown[]) => unknown

export type WorkerSandboxRpcHandlers = Record<string, WorkerSandboxRpcHandler>

export interface ExecuteInWorkerSandboxOptions {
  id: string
  code: string
  sourceURL?: string
  stopSignal: AbortSignal
  rpcHandlers?: WorkerSandboxRpcHandlers
  messagePort?: MessagePort | undefined
}

export type WorkerSandboxExecuteRequest = {
  kind: 'execute'
  code: string
  args: unknown[]
  sourceURL: string
}

export type WorkerSandboxRpcRequest = {
  kind: 'rpc-request'
  requestId: string
  rpcType: string
  args: unknown[]
}

export type WorkerSandboxRpcResult = {
  kind: 'rpc-result'
  requestId: string
  value: unknown
}

export type WorkerSandboxRpcError = {
  kind: 'rpc-error'
  requestId: string
  error: {
    message: string
    name?: string | undefined
    stack?: string | undefined
  }
}

export type WorkerSandboxResult = {
  kind: 'result'
  result: unknown
}

export type WorkerSandboxError = {
  kind: 'error'
  error: {
    message: string
    name?: string | undefined
    stack?: string | undefined
  }
}

export type WorkerSandboxHostToWorkerMessage =
  | WorkerSandboxExecuteRequest
  | WorkerSandboxRpcResult
  | WorkerSandboxRpcError

export type WorkerSandboxWorkerToHostMessage =
  | WorkerSandboxRpcRequest
  | WorkerSandboxResult
  | WorkerSandboxError

export type WorkerSandboxExecuteRequestEnvelope = {
  request: WorkerSandboxExecuteRequest
  messagePort?: MessagePort | undefined
}

export interface WorkerSandboxRuntime {
  execute<R = unknown>(
    request: WorkerSandboxExecuteRequestEnvelope,
    options: ExecuteInWorkerSandboxOptions,
  ): Promise<R>
}
