import {
  getOpenAIChatResponse,
  openAIUsed,
  getOpenAIAssistantResponse,
  ChatStateType,
} from './chat';
import { partialTaskDraft } from './types';
import { addTask2Tree } from './taskManager';
import { processTasksQueue } from './taskManager';
import {
  FunctionArguments,
  tools,
} from './tools';
import type { LLMTask } from './types';
import type { OpenAI } from 'openai';
import type { TaskyonDatabase } from './rxdb';
import { getTaskyonDB } from './taskManager';
import { handleFunctionExecution } from './tools';

export async function processChatTask(
  task: LLMTask,
  chatState: ChatStateType,
  db: TaskyonDatabase
) {
  if (chatState.useOpenAIAssistants && openAIUsed(chatState)) {
    const messages = await getOpenAIAssistantResponse(task, chatState, db);
    if (messages) {
      task.result = {
        type: 'ChatAnswer',
        assistantResponse: messages,
      };
    }
  } else {
    console.log('execute chat task!', task);
    const response = await getOpenAIChatResponse(task, chatState);
    if (response) {
      if (response.usage) {
        // openai sends back the exact number of prompt tokens :)
        task.debugging.promptTokens = response.usage.prompt_tokens;
        task.debugging.resultTokens = response.usage.completion_tokens;
        task.debugging.taskCosts = response.usage.inference_costs;
        task.debugging.taskTokens = response.usage.total_tokens;
      }
      if (response.choices.length > 0) {
        const choice = response.choices[0];
        task.result = {
          ...task.result,
          type: 'ChatAnswer',
          chatResponse: response,
        };

        // if our response contained a call to a function...
        // TODO: update this to the new tools API from Openai
        if (
          choice.finish_reason === 'function_call' &&
          !choice.message.content &&
          choice.message.function_call
        ) {
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
            const toolProps = tools[name].parameters.properties;
            funcArguments[Object.keys(toolProps)[0]] =
              choice.message.function_call.arguments;
          }
          task.result.type = 'FunctionCall';
          task.result.functionCall = { name, arguments: funcArguments };
        }
      }
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
        type: 'FunctionError',
        functionResult: `The function ${func.name} is not available in tools. Please select a valid function from this list: ${toolnames}`,
      };
    }
  }
  return task;
}

function createNewChatResponseTask(parentTask: LLMTask): partialTaskDraft[] {
  // Process the response and create new tasks if necessary
  console.log('create new response task');
  const taskListFromResponse: partialTaskDraft[] = [];
  if (parentTask.result?.chatResponse) {
    const chatResponse = parentTask.result.chatResponse;
    if (chatResponse.choices.length > 0) {
      const choice = chatResponse.choices[0];
      taskListFromResponse.push({
        role: choice.message.role,
        content: choice.message.content,
      });
    }
  } else if (parentTask.result?.assistantResponse) {
    const messages = parentTask.result.assistantResponse;
    console.log('create a new assistant response tasks...', messages);
    for (const tm of messages) {
      const allText = tm.content.filter(
        (m): m is OpenAI.Beta.Threads.MessageContentText => m.type === 'text'
      );
      taskListFromResponse.push({
        role: tm.role,
        content: allText
          .map((textContent) => textContent.text.value)
          .join('\n'),
        debugging: { threadMessage: tm },
      });
    }
  }
  return taskListFromResponse;
}

function generateFollowUpTasksFromResult(
  finishedTask: LLMTask,
  chatState: ChatStateType
) {
  console.log('generate follow up task');
  const childCosts = {
    promptTokens: finishedTask.debugging.resultTokens,
    taskTokens: finishedTask.debugging.taskTokens,
    taskCosts: finishedTask.debugging.taskCosts,
  };
  if (finishedTask.result?.type === 'ChatAnswer') {
    const newTaskDraftList = createNewChatResponseTask(finishedTask);
    let parentTask = finishedTask;
    for (const td of newTaskDraftList) {
      td.debugging = { ...td.debugging, ...childCosts };
      // put AI response in our chain as a new, completed task...
      // TODO: theoretically the user "viewing" the task would be its completion..
      //       so we could create it before sending it and then wait for AI to respond...
      const newResponseTaskId = addTask2Tree(
        {
          state: 'Completed',
          ...td,
        },
        parentTask,
        chatState,
        false
      );
      parentTask = chatState.Tasks[newResponseTaskId];
    }
    return parentTask.id;
  } else if (finishedTask.result?.type === 'FunctionCall') {
    const funcTaskid = addTask2Tree(
      {
        role: 'function',
        content: null,
        context: { function: finishedTask.result.functionCall },
        debugging: childCosts,
      },
      finishedTask,
      chatState,
      true
    );
    return funcTaskid;
  }
}

async function taskWorker(chatState: ChatStateType, db: TaskyonDatabase) {
  console.log('entering task worker loop...');
  while (true) {
    console.log('waiting for next task!');
    let task = await processTasksQueue.pop();
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
          task.result?.type === 'FunctionResult' ||
          task.result?.type === 'FunctionError'
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
      task.debugging = { error };
      console.error('Error processing task:', error);
    }
    void generateFollowUpTasksFromResult(task, chatState);
  }
}

export async function run(chatState: ChatStateType) {
  console.log('creating or opening task database...');

  const taskyonDB = await getTaskyonDB();
  console.log('start task taskWorker');
  await taskWorker(chatState, taskyonDB);
} // Helper function to handle function execution
