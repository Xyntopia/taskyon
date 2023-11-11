import { dump } from 'js-yaml';
import {
  getOpenAIChatResponse,
  openAIUsed,
  getOpenAIAssistantResponse,
  ChatStateType,
  addTask2Tree,
  bigIntToString,
  partialTaskDraft,
} from './chat';
import { processTasksQueue } from './taskManager';
import {
  FunctionArguments,
  FunctionCall,
  ToolCollection,
  tools,
} from './tools';
import { LLMTask, TaskResult, TaskState } from './types';

export async function handleFunctionExecution(
  func: FunctionCall,
  tools: ToolCollection
): Promise<{ result: TaskResult; state: TaskState; error?: string }> {
  try {
    let funcR: unknown = await tools[func.name].function(func.arguments);
    funcR = bigIntToString(funcR);
    const result: TaskResult = {
      type: 'FunctionResult',
      content: dump(funcR),
    };
    return { result, state: 'Completed' };
  } catch (error) {
    return {
      result: {
        type: 'FunctionResult',
        content: JSON.stringify(error),
      },
      state: 'Error',
    };
  }
}

export async function processUserTask(task: LLMTask, chatState: ChatStateType) {
  if (chatState.useOpenAIAssistants && openAIUsed(chatState)) {
    const messages = await getOpenAIAssistantResponse(task, chatState);
    if (messages) {
      task.result = {
        type: 'ChatAnswer',
        assistantResponse: messages,
      };
    }
  } else {
    console.log('execute chat task!', task);
    const response = await getOpenAIChatResponse(task, chatState);
    if (response?.usage) {
      // openai sends back the exact number of prompt tokens :)
      task.debugging.usedTokens = response.usage.prompt_tokens;
    }
    task.result = {
      type: 'ChatAnswer',
      chatResponse: response,
    };

    // Try to parse the function arguments from JSON, log and re-throw the error if parsing fails
    /*let funcArguments: FunctionArguments;
    try {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      funcArguments = JSON.parse(func.arguments);
    } catch (parseError) {
      // in this case, we assume, that the first parameter was meant...
      funcArguments = {};
      funcArguments[Object.keys(tools[func.name].parameters.properties)[0]] =
        func.arguments;
    }

    const functionCall = {
      name: func.name,
      arguments: funcArguments,
    };

    chatState.Tasks[newResponseTaskId].result = {
      type: 'FunctionCall',
      functionCall: functionCall,
    };*/
  }
  return task;
}

export async function processFunctionTask(task: LLMTask) {
  if (task.context?.function) {
    const func = task.context.function;
    console.log(`Calling function ${func.name}`);
    task.state = 'In Progress';
    if (tools[func.name]) {
      const { result, state } = await handleFunctionExecution(func, tools);
      task.result = result;
      task.state = state;
    } else {
      const toolnames = JSON.stringify(task.allowedTools);
      task.result = {
        type: 'FunctionResult',
        content: `The function ${func.name} is not available in tools. Please select a valid function from this list: ${toolnames}`,
      };
      task.state = 'Error';
    }
  }
  return task;
}

export function createNewChatResponseTask(
  parentTask: LLMTask
): partialTaskDraft {
  // Process the response and create new tasks if necessary
  console.log('create new response task');
  const taskFromResponse: partialTaskDraft = { role: 'assistant' };
  if (parentTask.result?.chatResponse) {
    const chatResponse = parentTask.result.chatResponse;
    taskFromResponse.debugging = {
      usedTokens: chatResponse.usage?.total_tokens,
      inference_costs: chatResponse.usage?.inference_costs,
      aiResponse: chatResponse,
    };
    if (chatResponse.choices.length > 0) {
      const choice = chatResponse.choices[0];
      taskFromResponse.role = choice.message.role;
      taskFromResponse.content = choice.message.content;
    }
  } else if (parentTask.result?.assistantResponse) {
    const messages = parentTask.result.assistantResponse;
    console.log('create a new assistant response task...', messages);
    //TODO: to the ThreadMessage stuff here...
    // TODO: we will create an entire chain of tasks here for each message we're geting back and
    // mark each of them as completed...
  }
  return taskFromResponse;
}

export function generateFollowUpTasksFromResult(
  finishedTask: LLMTask,
  chatState: ChatStateType
) {
  console.log('generate follow up task');
  if (finishedTask.result?.type === 'ChatAnswer') {
    const newTaskDraft = createNewChatResponseTask(finishedTask);
    // put AI response in our chain as a new, completed task...
    // TODO: theoretically the user "viewing" the task would be its completion..
    //       so we could create it before sending it and then wait for AI to respond...
    const newResponseTaskId = addTask2Tree(
      {
        state: 'Completed',
        ...newTaskDraft,
      },
      finishedTask,
      chatState,
      false
    );
    return newResponseTaskId;
  } else if (finishedTask.result?.type === 'FunctionCall') {
    const funcTaskid = addTask2Tree(
      {
        role: 'function',
        content: null,
        context: {
          function: finishedTask.result.functionCall,
        },
      },
      finishedTask,
      chatState,
      true
    );
    return funcTaskid;
  }
}

async function taskWorker(chatState: ChatStateType) {
  console.log('entering task worker loop...');
  while (true) {
    console.log('waiting for next task!');
    let task = await processTasksQueue.pop();
    task.state = 'In Progress';
    console.log('processing task:', task);
    try {
      if (task.role == 'user') {
        task = await processUserTask(task, chatState);
      } else if (task.role == 'function') {
        task = await processFunctionTask(task);
      } else {
        console.log("We don't know what to do with this task:", task);
        task.state = 'Error';
      }
    } catch (error) {
      task.state = 'Error';
      task.debugging = { error };
      console.error('Error processing task:', error);
    } finally {
      task.state = 'Completed';
    }
    void generateFollowUpTasksFromResult(task, chatState);
  }
}

export async function run(chatState: ChatStateType) {
  console.log('start task taskWorker');
  await taskWorker(chatState);
} // Helper function to handle function execution
