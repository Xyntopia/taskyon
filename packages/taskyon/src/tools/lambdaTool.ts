import { createChatCompletionTask } from '../api'
import type { ChatCompletionArgs } from './chatCompletionTool'
import {
  ScopedToolDefinition,
  type BindingImplementation,
  type partialTaskDraft,
  type ScopedToolDefinition as ScopedToolDefinitionType,
} from '../types/taskNode'
import {
  FunctionArguments,
  FunctionCall,
  type FunctionArguments as FunctionArgumentsType,
} from '../types/tools'
import type { ToolBase } from '../types/tools'

export type LambdaChatCompletionArgs = Omit<ChatCompletionArgs, 'allowedTools' | 'toolChoice'> & {
  allowedTools?: never
  toolChoice?: never
}

export type BoundLambdaDefinition = {
  name: string
  description: string
  longDescription?: string
  renderOptions?: ToolBase['renderOptions']
  source?: ToolBase['source']
  target: string
  fixedArguments?: FunctionArgumentsType
  publicArguments: BindingImplementation['publicArguments']
}

const rejectOwnedChatArguments = (args: LambdaChatCompletionArgs) => {
  if ('allowedTools' in args || 'toolChoice' in args) {
    throw new Error('lambda owns chatCompletion allowedTools and toolChoice')
  }
}

export const toolDefinitionTask = (definition: ScopedToolDefinitionType): partialTaskDraft => ({
  role: 'system',
  content: {
    type: 'tooldefinition',
    data: ScopedToolDefinition.parse(definition),
  },
})

export const lambda = (
  definition: ScopedToolDefinitionType,
  chatCompletionArgs: LambdaChatCompletionArgs = {},
): partialTaskDraft[] => {
  rejectOwnedChatArguments(chatCompletionArgs)
  const scopedDefinition = ScopedToolDefinition.parse(definition)
  return [
    toolDefinitionTask(scopedDefinition),
    createChatCompletionTask({
      ...chatCompletionArgs,
      allowedTools: [scopedDefinition.name],
      toolChoice: { type: 'tool', toolName: scopedDefinition.name },
    }),
  ]
}

export const bind = (
  definition: BoundLambdaDefinition,
  chatCompletionArgs: LambdaChatCompletionArgs = {},
): partialTaskDraft[] => {
  const target = FunctionCall.shape.name.parse(definition.target)
  const fixedArguments = FunctionArguments.parse(definition.fixedArguments ?? {})
  const publicArguments = Object.fromEntries(
    Object.entries(definition.publicArguments).map(([name, patch]) => [name, patch]),
  )
  const overlappingArguments = Object.keys(publicArguments).filter((name) =>
    Object.hasOwn(fixedArguments, name),
  )
  if (overlappingArguments.length > 0) {
    throw new Error(
      `Bound arguments must not be exposed by the lambda schema: ${overlappingArguments.join(', ')}`,
    )
  }

  return lambda(
    {
      name: definition.name,
      description: definition.description,
      implementation: {
        type: 'binding',
        target,
        fixedArguments,
        publicArguments,
      },
      ...(definition.longDescription ? { longDescription: definition.longDescription } : {}),
      ...(definition.renderOptions ? { renderOptions: definition.renderOptions } : {}),
      ...(definition.source ? { source: definition.source } : {}),
    },
    chatCompletionArgs,
  )
}
