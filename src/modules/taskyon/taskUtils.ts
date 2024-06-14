import type { LLMTask, TaskGetter } from './types';
import OpenAI from 'openai';
import { dump } from 'js-yaml';
import { FileMappingDocType } from './rxdb';

export const taskUtils = (
  getTask: TaskGetter,
  getFileMapping: (uuid: string) => Promise<FileMappingDocType | null>
) => {
  /* get a chain of taskss with the last task being the last element in the list */
  async function getTaskIdChain(taskId: string) {
    const conversationList: string[] = [];

    // Start with the selected task
    let currentTaskID: string | undefined = taskId;

    // Trace back the parentIDs to the original task in the chain
    while (currentTaskID) {
      // Get the current task
      const currentTask: LLMTask | undefined = await getTask(currentTaskID);
      if (currentTask) {
        // Prepend the current task to the conversation list so the selected task ends up being the last in the list
        conversationList.unshift(currentTaskID);
        currentTaskID = currentTask.parentID;
      } else {
        currentTaskID = undefined;
      } // Break if we reach a task that doesn't exist
    }

    return conversationList;
  }

  async function getTaskChain(taskId: string) {
    const taskIds = await getTaskIdChain(taskId);
    const taskList = await Promise.all(taskIds.map((tid) => getTask(tid)));
    return taskList;
  }

  async function buildChatFromTask(taskId: string) {
    const openAIMessageThread = [] as OpenAI.ChatCompletionMessageParam[];
    const conversationThread = await getTaskIdChain(taskId);

    // instructions & prompts are added at a later stage...
    if (conversationThread) {
      for (const mId of conversationThread) {
        const t = await getTask(mId);
        let message: OpenAI.ChatCompletionMessageParam | undefined = undefined;
        if (t) {
          if ('functionCall' in t.content) {
            const functionContent = dump({
              arguments: t.content.functionCall.arguments,
              ...t.result?.toolResult,
            });
            message = {
              role: 'function',
              name: t.content.functionCall.name,
              content: functionContent,
            };
            openAIMessageThread.push(message);
          } else if ('functionResult' in t.content) {
            message = {
              role: 'system',
              content: dump({
                'result of the function': t.content.functionResult,
              }),
            } as Exclude<
              OpenAI.ChatCompletionMessageParam,
              OpenAI.ChatCompletionFunctionMessageParam
            >;
            openAIMessageThread.push(message);
          } else if ('message' in t.content) {
            message = {
              role: t.role,
              content: t.content.message,
            } as Exclude<
              OpenAI.ChatCompletionMessageParam,
              OpenAI.ChatCompletionFunctionMessageParam
            >;
            openAIMessageThread.push(message);
          } else if ('uploadedFiles' in t.content) {
            const fileNames = (
              await Promise.all(
                t.content.uploadedFiles.map((uuid) => getFileMapping(uuid))
              )
            )
              .map((fm) => '- ' + (fm?.name || fm?.opfs || 'unknown'))
              .join('\n');
            message = {
              role: t.role,
              content: `user uploaded files:\n${fileNames}`,
            } as Exclude<
              OpenAI.ChatCompletionMessageParam,
              OpenAI.ChatCompletionFunctionMessageParam
            >;
            openAIMessageThread.push(message);
          }
        }
      }
    }
    return openAIMessageThread;
  }
  return {
    taskChain: getTaskIdChain,
    buildChatFromTask,
    getTaskChain,
  };
};

export function findAllFilesInTasks(taskList: LLMTask[]): string[] {
  const fileSet = new Set<string>();
  taskList.forEach((task) => {
    if ('uploadedFiles' in task.content) {
      task.content.uploadedFiles.forEach((file) => fileSet.add(file));
    }
  });
  return Array.from(fileSet);
}
