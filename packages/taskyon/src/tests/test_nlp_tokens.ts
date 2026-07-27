import type { OpenAIMessage } from '../types/chatCompletion'
import type { TaskNode } from '../types/taskNode'
import type { ToolBase } from '../types/tools'
import { createNlpWorkerApi } from '../utils/nlp.worker'

const mockTask: TaskNode = {
  role: 'assistant',
  id: 'test',
  content: { type: 'message', data: 'Sample content for task node' },
}

const mockChatMessages: OpenAIMessage[] = [
  { role: 'user', content: 'Hello, how are you?' },
  { role: 'assistant', content: "I'm good, thank you!" },
]

const mockTools: Record<string, ToolBase> = {
  tool1: {
    name: 'tool1',
    description: 'Tool 1 description',
    parameters: {
      type: 'object',
      properties: {
        param1: { type: 'string', description: 'some parameter1.' },
      },
      required: ['param1'],
    },
  },
  tool2: {
    name: 'tool2',
    description: 'Tool 2 description',
    parameters: {
      type: 'object',
      properties: {
        param2: { type: 'string', description: 'some parameter2.' },
      },
    },
  },
}

export async function testEstimateChatTokens() {
  const tokens = await createNlpWorkerApi().estimateChatTokens(
    mockTask.content,
    mockChatMessages,
    mockTools,
    Object.values(mockTools).map((tool) => tool.name),
  )
  return tokens
}
