import { ChatStateType, processOpenAIConversation } from './chat';
import { processTasksQueue } from './taskManager';
import { handleFunctionExecution } from './taskManager';
import { tools } from './tools';
import { LLMTask } from './types';

// Function to process user tasks

export async function processUserTask(task: LLMTask, chatState: ChatStateType) {
  await processOpenAIConversation(task, chatState);
  task.state = 'Completed';
}
// Function to process function tasks

export async function processFunctionTask(
  task: LLMTask,
  chatState: ChatStateType
) {
  if (task.context?.function) {
    const func = task.context.function;
    console.log(`Calling function ${func.name}`);
    task.state = 'In Progress';
    const { result, state } = await handleFunctionExecution(func);
    task.result = result;
    task.allowedTools = Object.keys(tools);
    await processOpenAIConversation(task, chatState);
    task.state = state;
  }
}
async function taskWorker(chatState: ChatStateType) {
  console.log('entering task worker loop...');
  while (true) {
    console.log('waiting for next task!');
    const task = await processTasksQueue.pop();
    task.state = 'In Progress';
    console.log('processing task:', task);
    try {
      if (task.role == 'user') {
        await processUserTask(task, chatState);
      } else if (task.role == 'function') {
        await processFunctionTask(task, chatState);
      } else {
        console.log("We don't know what to do with this task:", task);
        task.state = 'Error';
      }
    } catch (error) {
      task.state = 'Error';
      task.debugging = { error };
      console.error('Error processing task:', error);
    }
  }
}

export async function run(chatState: ChatStateType) {
  console.log('start task taskWorker');
  await taskWorker(chatState);
}
