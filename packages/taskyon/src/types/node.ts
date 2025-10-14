import z from 'zod'
import type { Expand } from '../utils/tsHelpers'
import { FunctionCall, ToolBase } from './tools'

export const Annotation = z.union([
  z.object({
    type: z.literal('url_citation'),
    url_citation: z
      .object({
        end_index: z.number(),
        start_index: z.number(),
        title: z.string(),
        url: z.string(),
        content: z.string(),
      })
      .partial()
      .optional(),
  }),
  z.object({
    type: z.literal('file'),
    content: z
      .object({
        text: z.string(),
        type: z.string(),
      })
      .array()
      .optional(),
  }),
])

export type Annotation = z.infer<typeof Annotation>

const MessageContent = z.object({
  type: z.literal('message'),
  data: z.string(),
  ann: Annotation.array().optional(),
})
const StructuredContent = z.object({
  type: z.literal('structured'),
  data: z.unknown(),
})
const ToolCallContent = z.object({ type: z.literal('functioncall'), data: FunctionCall })
const UploadedFilesContent = z.object({
  type: z.literal('files'),
  data: z.array(z.string()),
})
const ToolResultContent = z.object({ type: z.literal('toolresult'), data: z.unknown() })
const ToolDefinition = z.object({ type: z.literal('tooldefinition'), data: ToolBase })
const ErrorContent = z.object({ type: z.literal('error'), data: z.unknown() }).meta({
  description: 'Gets created if any error occurs during task processing.',
})
const Return = z.object({ type: z.literal('return'), data: z.string() }).describe(
  `A Termination task always indicates the end of an autonomous task chat execution.
Every Leaf task which is not a Termination task can potentially continue to be executed...

We can indicate the reason for termination here as well...`,
)

// TODO: I am not sure, if we need this here...
const ChatCompletionContent = z.union([MessageContent, ToolResultContent, ErrorContent])
export type ChatCompletionContent = z.infer<typeof ChatCompletionContent>

export const TaskContent = z.union([
  MessageContent.strict(),
  ToolResultContent.strict(),
  ToolDefinition.strict(),
  ErrorContent.strict(),
  StructuredContent.strict(),
  ToolCallContent.strict(),
  // TODO: replace with a "context" function which can also be a link to a URL for example or maybe a search string for other tasks...
  //       we can declare function for a lot of these things this way :)
  UploadedFilesContent.strict(),
  Return.strict(),
])

export type TaskContent = z.infer<typeof TaskContent>

export const TaskNode = z.object({
  // TODO: get rid of "role"  and put it into chatCompletion only...
  // we don't need it in the rest of the app, I think.. we might be able to indicate that a task was
  // "automatically" created by using a notation in "authorID" e.g. something like.
  // "pubKey:gen" if the task was automatically generated && pubKey if it wasn't
  // OR: we could simply check the parents & priors of tasks. if tasks have a parent, they were generated
  // by a function. user-generated message should not have a parent...
  role: z.enum(['system', 'user', 'assistant', 'function']),
  name: z.string().optional().meta({
    description: 'An optional name for the task',
  }),
  content: TaskContent.describe(
    `This is the actual content of the task. This is the actual content which is process at each step.
For example this is, what an LLM would actually get to see. There are only a few different ways
of how content can be structured. `,
  ),
  label: z.array(z.string()).optional(),
  parentID: z.string().optional().meta({
    description: 'The ID of the parent task which created this subtask on a lower stack level',
  }),
  priorID: z.string().optional().meta({
    description: 'The ID of the previous task in the same stack level.',
  }),
  // TODO: validate this ID using our content address creation functions
  id: z.string(),
  authorId: z.string().optional(),
  created_at: z.number().optional(),
  acl: z.string().array().optional()
    .describe(`A number of public keys which act as access control lists (ACL).
They are given certain as a list of public keys + type of ownership.
 ["pubkey:owner", "pubkey:editor1", "pubkey:editor2"]

 The value is optional. If no ACL is specified, the task is "public" and
 can for example be freely exchange in p2p settings.

TODO: define onwership types..`),
  sig: z.string().optional().meta({
    description:
      'A signature from the author of the Task. It is created from the entire content of the tasj except for the signature itself.',
  }),
})
export type TaskNode = z.infer<typeof TaskNode>

export const partialTaskDraft = TaskNode.partial().required({ role: true, content: true }).meta({
  description:
    'This is just a subset of the task properties which can be used to define new tasks in various places.',
})
export type partialTaskDraft = z.infer<typeof partialTaskDraft>

// If you want to map them to { label, value } for q-select:
export const taskTypeOptions = TaskContent.options.map((opt) => {
  // each option is a ZodObject with a `type` literal
  return opt.shape.type._zod.def.values[0]!
})

// TODO: the goal should be to slowly replace this state by the "result of the task"
//       E.g. when a task had an error, this would be represented in the task result as an "error"
const TaskState = z.enum(['Open', 'Queued', 'In Progress', 'Completed', 'Cancelled', 'Error'])
  .describe(`The task state indicates on what is happening with the task: for example
it shows whether a task flow is seen as "completed" or whether its waiting
to be further processed... E.g. there could be a task with no results, which stil counts as "completed"`)
export type TaskState = z.infer<typeof TaskState>

// Now pull out the tooldefinition variant and fully expand it:
/*type ToolDefinitionNode = ExpandRecursively<
  Omit<TaskNode, 'content'> & {
    content: Extract<TaskNode['content'], { type: 'tooldefinition' }>
  }
>*/

/*type ToolDefinitionNode = TaskNode extends { content: infer C }
  ? C extends { type: 'tooldefinition' }
    ? Expand<Omit<TaskNode, 'content'> & { content: C }>
    : never
  : never*/

// 2. Generic extractor by content.type
export type TaskNodeType<K extends TaskNode['content']['type']> = TaskNode extends {
  content: infer C
}
  ? C extends { type: K }
    ? Expand<Omit<TaskNode, 'content'> & { content: C }>
    : never
  : never
/*
// 3. Example usages
type ToolDefNode    = TaskNodeType<"tooldefinition">
type MessageNode    = TaskNodeType<"message">
type ToolResultNode = TaskNodeType<"toolresult">
*/

export type TaskGetter = (input: string) => Promise<TaskNode | null>

export type FileMapping = {
  id: string
  name?: string
  size?: number
  // filename in opfs
  opfs?: string
  openAIFileId?: string
  // TODO: we're not sure if we need a file path?
  type: string
  // sometimes, for very small files, it might make sense to attach the data here directly?
  data?: string
}

export interface TaskTreeNode {
  task: TaskNode
  children: TaskTreeNode[][]
}
