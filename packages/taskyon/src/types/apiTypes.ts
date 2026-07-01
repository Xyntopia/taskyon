import { z } from 'zod'
import { taskyonProtocol } from '../api/taskyonProtocol'

// TODO: most of the messages here should have an equivalent encrypted version!

const withBaseMessage = <TShape extends z.ZodRawShape>(schema: z.ZodObject<TShape>) =>
  z.object({ ...BaseMessage.shape, ...schema.shape })

export const ToolDefinitionsRequestMessage = taskyonProtocol.commands.listTools.request
export const ToolDefinitionsResponseMessage = taskyonProtocol.commands.listTools.response

export const BaseMessage = taskyonProtocol.envelope

export const TaskWorkerMessage = z.discriminatedUnion('type', [
  withBaseMessage(taskyonProtocol.streams.toolExecution.functionCall),
  withBaseMessage(taskyonProtocol.streams.toolExecution.functionResponse),
  withBaseMessage(taskyonProtocol.streams.toolExecution.functionCancel),
])
export type TaskWorkerMessage = z.infer<typeof TaskWorkerMessage>

export const EncryptedTasks = taskyonProtocol.commands.importTaskArchive.request
export const EncryptedTasksResponse = taskyonProtocol.commands.importTaskArchive.response
export const RequestTask = taskyonProtocol.commands.requestTaskArchive.request
export const RequestTaskResponse = taskyonProtocol.commands.requestTaskArchive.response
export const TaskCreated = taskyonProtocol.streams.taskUpdates.taskCreated
export const FileMessage = taskyonProtocol.commands.addFile.request
export type FileMessage = z.infer<typeof FileMessage>

export const TyP2P = z.discriminatedUnion('type', [
  EncryptedTasks,
  EncryptedTasksResponse,
  RequestTask,
  RequestTaskResponse,
  TaskCreated,
])
export type TyP2P = z.infer<typeof TyP2P>

export const TyBusMessage = z.discriminatedUnion('type', [
  ...TyP2P.options,
  withBaseMessage(taskyonProtocol.streams.peerLifecycle.status),
  ...TaskWorkerMessage.options,
])

export const TaskyonMessage = z.discriminatedUnion('type', [
  // TODO: can we unify the task message with the SyncApi?
  ...TyBusMessage.options,
  withBaseMessage(taskyonProtocol.commands.createTask.request),
  withBaseMessage(taskyonProtocol.commands.createTask.response),
  withBaseMessage(taskyonProtocol.commands.createTaskChain.request),
  withBaseMessage(taskyonProtocol.commands.createTaskChain.response),
  withBaseMessage(taskyonProtocol.commands.registerTool.request),
  withBaseMessage(taskyonProtocol.commands.registerTool.response),
  withBaseMessage(taskyonProtocol.commands.addFile.request),
  withBaseMessage(taskyonProtocol.commands.addFile.response),
  withBaseMessage(taskyonProtocol.streams.peerLifecycle.taskyonReady),
  withBaseMessage(ToolDefinitionsRequestMessage),
  withBaseMessage(ToolDefinitionsResponseMessage),
])

// If you want to map them to { label, value } for q-select:
/*export const messageTypes = TaskyonMessage.options.map((opt) => {
  // each option is a ZodObject with a `type` literal
  return opt.shape.type._zod.def.values[0]!
})*/

export type TaskyonMessage = z.infer<typeof TaskyonMessage>
export type messageTypes = TaskyonMessage['type']
