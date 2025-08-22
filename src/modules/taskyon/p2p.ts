import z from 'zod'

// p2p.ts
export const BaseMessage = z.object({ origin: z.string().optional() })

export const EncryptedTasks = z.object({
  type: z.literal('addTasks'),
  data: z.instanceof(Uint8Array) as z.ZodType<Uint8Array>,
  info: z.string(),
  ids: z.array(z.string()),
})
//type TaskMessage = z.infer<typeof EncryptedTasks>

export const RequestTask = z.object({
  type: z.literal('requestTask'),
  id: z.string(),
})
//type RequestTask = z.infer<typeof RequestTask>

export const TaskCreated = z.object({
  type: z.literal('taskCreated'),
  ids: z.array(z.string()),
  info: z.string(),
})

export const SyncApi = z.discriminatedUnion('type', [EncryptedTasks, RequestTask, TaskCreated])
export type SyncApi = z.infer<typeof SyncApi>
