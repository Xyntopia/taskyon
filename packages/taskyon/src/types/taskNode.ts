import z from 'zod'
import type { Expand } from '../utils/tsHelpers'
import { ContentHash, FunctionArguments, FunctionCall, ToolBase } from './tools'
import { JSONSchema7 } from '../utils/jsonSchema'

export const Annotation = z.union([
  z
    .object({
      type: z.literal('url'),
      id: z.string(),
      end_index: z.number(),
      start_index: z.number(),
      title: z.string(),
      url: z.string(),
      content: z.string(),
    })
    .partial()
    .required({ type: true }),
  z
    .object({
      type: z.literal('document'),
      text: z.string().optional(),
      content: z.string().optional(),
    })
    .partial()
    .required({ type: true }),
])

export type Annotation = z.infer<typeof Annotation>

const MessageContent = z.object({
  type: z.literal('message').describe('Identifies conversational text content.'),
  data: z.string().describe('Text presented as the task message.'),
  ann: Annotation.array().optional().describe('Source annotations attached to the message.'),
})
const StructuredContent = z.object({
  type: z.literal('structured').describe('Identifies machine-readable structured content.'),
  data: z.unknown().describe('Structured task value defined by the producing tool or workflow.'),
})
const ToolCallContent = z.object({
  type: z.literal('functioncall').describe('Identifies a requested tool call.'),
  data: FunctionCall.describe('Tool name and arguments to invoke.'),
})
export const FileAttachment = z.object({
  hash: z
    .string()
    .regex(/^sha256:[A-Za-z0-9_-]{43}$/)
    .describe('SHA-256 content hash identifying the stored bytes.'),
  name: z.string().describe('File name used for this attachment.'),
  mediaType: z.string().describe('Media type used for this attachment.'),
  size: z.number().int().nonnegative().describe('File size in bytes.'),
})
export type FileAttachment = z.infer<typeof FileAttachment>

const UploadedFilesContent = z.object({
  type: z.literal('files').describe('Identifies file-reference content.'),
  data: z
    .array(z.union([FileAttachment, z.string()]))
    .describe('Content-addressed files attached to the task; strings are legacy references.'),
})
const ToolResultContent = z.object({
  type: z.literal('toolresult').describe('Identifies the result of a tool call.'),
  data: z.unknown().describe('Result value returned by the tool.'),
})
export const BindingImplementation = z.strictObject({
  type: z.literal('binding'),
  target: FunctionCall.shape.name,
  targetRevision: FunctionCall.shape.toolRevision.optional(),
  fixedArguments: FunctionArguments.default({}),
  publicArguments: z.record(z.string(), JSONSchema7),
})
export type BindingImplementation = z.infer<typeof BindingImplementation>

const ScopedCodeToolDefinition = ToolBase.required({ code: true }).strict()
const ScopedBindingToolDefinition = ToolBase.omit({ code: true, parameters: true })
  .extend({ implementation: BindingImplementation })
  .strict()

export const ScopedToolDefinition = z
  .union([ScopedCodeToolDefinition, ScopedBindingToolDefinition])
  .describe('A sandboxed or declarative tool definition scoped to following lineage tasks.')
export type ScopedToolDefinition = z.infer<typeof ScopedToolDefinition>

const ToolDefinition = z.object({
  type: z.literal('tooldefinition').describe('Identifies a Taskyon tool definition.'),
  data: ScopedToolDefinition.describe('Sandboxed tool definition made available by this task.'),
})
const ErrorContent = z
  .object({
    type: z.literal('error').describe('Identifies task-processing error content.'),
    data: z.unknown().describe('Error details reported by the failed task step.'),
  })
  .meta({
    description: 'Gets created if any error occurs during task processing.',
  })
const Return = z
  .object({
    type: z.literal('return').describe('Identifies a terminal task result.'),
    data: z.string().describe('Human-readable reason or final result for task termination.'),
  })
  .describe(
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
export type TaskContentType = TaskContent extends { type: infer T } ? T : never

export const TaskNode = z.object({
  // TODO: get rid of "role"  and put it into chatCompletion only...
  // we don't need it in the rest of the app, I think.. we might be able to indicate that a task was
  // "automatically" created by using a notation in "authorID" e.g. something like.
  // "pubKey:gen" if the task was automatically generated && pubKey if it wasn't
  // OR: we could simply check the parents & priors of tasks. if tasks have a parent, they were generated
  // by a function. user-generated message should not have a parent...
  role: z
    .enum(['system', 'user', 'assistant', 'function'])
    .describe('Message role used when the task is presented to a language model.'),
  name: z.string().optional().meta({
    description: 'An optional name for the task',
  }),
  content: TaskContent.describe(
    `This is the actual content of the task. This is the actual content which is process at each step.
For example this is, what an LLM would actually get to see. There are only a few different ways
of how content can be structured. `,
  ),
  label: z.array(z.string()).optional().describe('Optional labels used to categorize the task.'),
  parentID: z.string().optional().meta({
    description: 'The ID of the parent task which created this subtask on a lower stack level',
  }),
  priorID: z.string().optional().meta({
    description: 'The ID of the previous task in the same stack level.',
  }),
  // TODO: validate this ID using our content address creation functions
  id: z.string().describe('Content-derived task identifier.'),
  authorId: z.string().optional().describe('Identifier of the task author, when known.'),
  created_at: z
    .number()
    .optional()
    .describe('Task creation time as milliseconds since the Unix epoch.'),
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

export const TaskContentRecord = z.strictObject({
  id: ContentHash,
  content: TaskContent,
})
export type TaskContentRecord = z.infer<typeof TaskContentRecord>

export const TaskNodeRecord = TaskNode.omit({ content: true }).extend({
  contentRef: ContentHash,
})
export type TaskNodeRecord = z.infer<typeof TaskNodeRecord>

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

export interface TaskTreeNode {
  task: TaskNode
  children: TaskTreeNode[][]
}
