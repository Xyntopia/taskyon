import {
  getOpenAIChatResponse,
  openAIUsed,
  getOpenAIAssistantResponse,
  ChatStateType,
} from './chat';
import { yamlToolChatType } from './types';
import { partialTaskDraft } from './types';
import { addTask2Tree } from './taskManager';
import { processTasksQueue } from './taskManager';
import { FunctionArguments, FunctionCall, tools } from './tools';
import type { ChatCompletionResponse, LLMTask } from './types';
import type { OpenAI } from 'openai';
import type { TaskyonDatabase } from './rxdb';
import { getTaskyonDB } from './taskManager';
import { handleFunctionExecution } from './tools';
import { load } from 'js-yaml';

function isOpenAIFunctionCall(
  choice: ChatCompletionResponse['choices'][0]
): choice is ChatCompletionResponse['choices'][0] & {
  message: { function_call: FunctionCall };
} {
  return (
    choice.finish_reason === 'function_call' &&
    !choice.message.content &&
    !!choice.message.function_call
  );
}

function extractOpenAIFunction(choice: ChatCompletionResponse['choices'][0]) {
  if (isOpenAIFunctionCall(choice)) {
    // if our response contained a call to a function...
    // TODO: update this to the new tools API from Openai
    console.log('A function call was returned...');
    const name = choice.message.function_call.name;
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    let funcArguments: FunctionArguments = {};
    try {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      funcArguments = JSON.parse(choice.message.function_call.arguments);
    } catch (parseError) {
      // in this case, we assume, that the first parameter was meant...
      funcArguments = {};
      const toolProps = tools[name]?.parameters.properties;
      if (toolProps) {
        funcArguments[Object.keys(toolProps)[0]] =
          choice.message.function_call.arguments;
      }
    }
    const functionCall: FunctionCall = {
      name,
      arguments: funcArguments,
    };
    return functionCall;
  }
}

export async function processChatTask(
  task: LLMTask,
  chatState: ChatStateType,
  db: TaskyonDatabase
) {
  if (chatState.useOpenAIAssistants && openAIUsed(chatState)) {
    const messages = await getOpenAIAssistantResponse(task, chatState, db);
    if (messages) {
      task.result = {
        type: 'AssistantAnswer',
        assistantResponse: messages,
      };
    }
  } else {
    console.log('execute chat task!', task);
    //TODO: also do this, if we start the task "autonomously" in which we basically
    //      allow it to create new tasks...
    //TODO: we can create more things here like giving it context form other tasks, lookup
    //      main objective, previous tasks etc....
    const useToolChat = task.allowedTools && !chatState.enableOpenAiTools;
    const response = await getOpenAIChatResponse(
      task,
      chatState,
      useToolChat ? 'toolchat' : 'chat'
    );

    if (response?.usage) {
      // openai sends back the exact number of prompt tokens :)
      task.debugging.promptTokens = response.usage.prompt_tokens;
      task.debugging.resultTokens = response.usage.completion_tokens;
      task.debugging.taskCosts = response.usage.inference_costs;
      task.debugging.taskTokens = response.usage.total_tokens;
    }
    const choice = response?.choices[0];
    if (choice) {
      task.result = {
        ...task.result,
        type: useToolChat
          ? 'ToolChatResult'
          : isOpenAIFunctionCall(choice)
          ? 'ToolCall'
          : 'ChatAnswer',
        chatResponse: response,
      };
    }
  }

  return task;
}

export async function processFunctionTask(task: LLMTask) {
  if (task.context?.function) {
    const func = task.context.function;
    console.log(`Calling function ${func.name}`);
    if (tools[func.name]) {
      const result = await handleFunctionExecution(func, tools);
      task.result = result;
    } else {
      const toolnames = JSON.stringify(task.allowedTools);
      task.result = {
        type: 'ToolError',
        toolResult: {
          error: `The function ${func.name} is not available in tools. Please select a valid function from this list: ${toolnames}`,
        },
      };
    }
  }
  return task;
}

function createNewAssistantResponseTask(
  parentTask: LLMTask
): partialTaskDraft[] {
  // Process the response and create new tasks if necessary
  console.log('create new response task');
  const taskListFromResponse: partialTaskDraft[] = [];
  const messages = parentTask.result?.assistantResponse || [];
  console.log('create a new assistant response tasks...', messages);
  for (const tm of messages) {
    const allText = tm.content.filter(
      (m): m is OpenAI.Beta.Threads.MessageContentText => m.type === 'text'
    );
    taskListFromResponse.push({
      role: tm.role,
      content: allText.map((textContent) => textContent.text.value).join('\n'),
      debugging: { threadMessage: tm },
    });
  }
  return taskListFromResponse;
}

async function generateFollowUpTasksFromResult(
  finishedTask: LLMTask,
  chatState: ChatStateType
) {
  console.log('generate follow up task');
  const childCosts = {
    promptTokens: finishedTask.debugging.resultTokens,
    taskTokens: finishedTask.debugging.taskTokens,
    taskCosts: finishedTask.debugging.taskCosts,
  };
  if (finishedTask.result) {
    const taskDraftList: partialTaskDraft[] = [];
    let execute = false;
    if (finishedTask.result.type === 'ChatAnswer') {
      const choice = finishedTask.result.chatResponse?.choices[0];
      if (choice) {
        taskDraftList.push({
          state: 'Completed',
          role: choice.message.role,
          content: choice.message.content,
        });
      }
    } else if (finishedTask.result.type === 'AssistantAnswer') {
      const newTaskDraftList = createNewAssistantResponseTask(finishedTask);
      for (const td of newTaskDraftList) {
        td.debugging = { ...td.debugging, ...childCosts };
        taskDraftList.push({
          state: 'Completed',
          ...td,
        });
      }
    } else if (finishedTask.result.type === 'ToolChatResult') {
      const choice = finishedTask.result.chatResponse?.choices[0];
      // parse the response and create a new task filled with the correct parameters
      const parsedYaml = load(choice?.message.content?.trim() || '');
      const toolChatResult = await yamlToolChatType.safeParseAsync(parsedYaml);
      if (toolChatResult.success) {
        console.log(toolChatResult);
        if (toolChatResult.data.toolCommand) {
          taskDraftList.push({
            role: 'function',
            content: null,
            context: {
              function: {
                name: toolChatResult.data.toolCommand.name,
                arguments: toolChatResult.data.toolCommand.args,
              },
            },
            debugging: childCosts,
          });
          execute = true;
        } else {
          taskDraftList.push({
            state: 'Completed',
            role: choice?.message.role || 'assistant',
            content:
              toolChatResult.data.answer ||
              toolChatResult.data.reasoning ||
              choice?.message.content,
          });
        }
      } else {
        taskDraftList.push({
          state: 'Completed',
          role: choice?.message.role || 'system',
          content: toolChatResult.error.toString(),
        });
      }
    } else if (finishedTask.result.type === 'ToolCall') {
      const choice = finishedTask.result.chatResponse?.choices[0];
      if (choice) {
        const functionCall = extractOpenAIFunction(choice);
        if (functionCall) {
          taskDraftList.push({
            role: 'function',
            content: null,
            context: { function: functionCall },
            debugging: childCosts,
          });
          execute = true;
        }
      }
    }
    let parentTask = finishedTask;
    for (const taskDraft of taskDraftList) {
      const newId = addTask2Tree(taskDraft, parentTask, chatState, execute);
      parentTask = chatState.Tasks[newId]; // create sequental task chain
    }
  }
}

const TASK_CANCELLATION_EVENT = 'cancelTasks';
const CURRENT_TASK_CANCELLATION_EVENT = 'cancelCurrentTask';
const RUNNING_TASK_WORKER_CANCELLATION_EVENT = 'cancelRunningTaskWorker';

export function emitCancelAllTasks() {
  document.dispatchEvent(new CustomEvent(TASK_CANCELLATION_EVENT));
}

export function emitCancelTaskWorker() {
  document.dispatchEvent(
    new CustomEvent(RUNNING_TASK_WORKER_CANCELLATION_EVENT)
  );
}

export function emitCancelCurrentTask() {
  document.dispatchEvent(new CustomEvent(CURRENT_TASK_CANCELLATION_EVENT));
}

async function taskWorker(chatState: ChatStateType, db: TaskyonDatabase) {
  let cancelAllTasks = false;
  let cancelImmediately = false;
  let cancelCurrenTask = false;

  const cancelCurrentTaskListener = () => {
    cancelCurrenTask = true;
    console.log('Received signal to cancel current task');
  };

  const cancelTasksListener = () => {
    cancelAllTasks = true;
    console.log('Received signal to cancel all queued tasks');
  };

  const cancelImmediatelyListener = () => {
    cancelImmediately = true;
    console.log('Received signal for immediate cancellation');
    document.removeEventListener(
      RUNNING_TASK_WORKER_CANCELLATION_EVENT,
      cancelImmediatelyListener
    );
    throw new Error('Task Worker immediately cancelled');
  };

  document.addEventListener(
    CURRENT_TASK_CANCELLATION_EVENT,
    cancelCurrentTaskListener
  );
  document.addEventListener(TASK_CANCELLATION_EVENT, cancelTasksListener);
  document.addEventListener(
    RUNNING_TASK_WORKER_CANCELLATION_EVENT,
    cancelImmediatelyListener
  );

  window.addEventListener('beforeunload', () => {
    processTasksQueue.clear().forEach((t) => (t.state = 'Cancelled'));
  });

  console.log('entering task worker loop...');
  while (!cancelImmediately) {
    console.log('waiting for next task!');
    let task = await processTasksQueue.pop();
    if (!processTasksQueue.count()) {
      cancelAllTasks = false;
      cancelCurrenTask = false;
    } else if (cancelAllTasks) {
      task.state = 'Cancelled';
      continue;
    }
    task.state = 'In Progress';
    console.log('processing task:', task);
    try {
      if (task.role == 'user') {
        task = await processChatTask(task, chatState, db);
        task.state = 'Completed';
      } else if (task.role == 'function') {
        // in the case of 'FunctionCall' result, we run it twice:
        // 1. calculate function result
        // 2. send function to LLM inference
        // the task could potentially come back as another functionCall!
        // the way this works: -> task state is "Completed" with "FunctionCall" and follow-up
        // functiontask will be generated
        if (
          task.result?.type === 'ToolResult' ||
          task.result?.type === 'ToolError'
        ) {
          // here we send the task to our LLM inference
          task = await processChatTask(task, chatState, db);
          task.state = 'Completed';
        } else {
          // in the case we don't have a result yet, we need to calculate it :)
          task = await processFunctionTask(task);
          processTasksQueue.push(task); // send the task back into the queue
          task.state = 'Queued';
        }
      } else {
        console.log("We don't know what to do with this task:", task);
        task.state = 'Error';
      }
    } catch (error) {
      task.state = 'Error';
      task.debugging.error = error;
      console.error('Error processing task:', error);
    }
    // if we cancelled a task we need to prevent it from creating any follow-up tasks.
    if (
      (cancelCurrenTask && task.id == chatState.selectedTaskId) ||
      cancelAllTasks
    ) {
      // current task cancellation should only be done once, so we set the flag to "false"
      cancelCurrenTask = false;
      task.state = 'Cancelled';
    } else {
      try {
        await generateFollowUpTasksFromResult(task, chatState);
      } catch (error) {
        task.state = 'Error';
        task.debugging.followUpError = error;
        console.log('We were not able to create a follow up task:', error);
      }
    }
  }

  document.removeEventListener(
    TASK_CANCELLATION_EVENT,
    cancelCurrentTaskListener
  );
  document.removeEventListener(
    CURRENT_TASK_CANCELLATION_EVENT,
    cancelCurrentTaskListener
  );
}

export async function run(chatState: ChatStateType) {
  console.log('creating or opening task database...');

  const taskyonDB = await getTaskyonDB();
  console.log('start task taskWorker');
  await taskWorker(chatState, taskyonDB);
} // Helper function to handle function execution
