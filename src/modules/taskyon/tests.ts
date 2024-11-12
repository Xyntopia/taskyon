import type { TaskNode, ToolBase } from './types';
import type OpenAI from 'openai';
import { useNlpWorker } from './webWorkerApi';
import { useTaskyonStore } from 'src/stores/taskyonState';

const state = useTaskyonStore();

const mockTask: TaskNode = {
  allowedTools: ['tool1', 'tool2'],
  role: 'assistant',
  state: 'Open',
  id: 'test',
  content: { message: 'Sample content for task node' },
  debugging: { estimatedTokens: {} },
};

const mockChatMessages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
  { role: 'user', content: 'Hello, how are you?' },
  { role: 'assistant', content: "I'm good, thank you!" },
];

const mockTools: Record<string, ToolBase> = {
  tool1: {
    name: 'tool1',
    description: 'Tool 1 description',
    parameters: {
      type: 'object',
      properties: {
        param1: {
          type: 'string',
          description: 'some parameter1.',
        },
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
        param2: {
          type: 'string',
          description: 'some parameter2.',
        },
      },
    },
  },
};

export async function testVectorizeText() {
  const nlpWorker = useNlpWorker();
  const testText = 'Sample text for vectorization';
  const modelName = state.llmSettings.vectorizationModel; // Mock model name
  const vector = await nlpWorker.vectorizeText(testText, modelName);
  const testSum = vector?.reduce((p, c) => p + c, 0);
  console.log('Vectorize Text Result Test Sum:', testSum);
  return testSum;
}

export async function testEstimateChatTokens() {
  const nlpWorker = useNlpWorker();

  const tokens = await nlpWorker.estimateChatTokens(
    mockTask,
    mockChatMessages,
    mockTools,
  );
  console.log('Estimate Chat Tokens Result:', tokens);
  return tokens;
}
