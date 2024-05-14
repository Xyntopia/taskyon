import type { LLMTask, TaskGetter } from './types';
import OpenAI from 'openai';
import { dump } from 'js-yaml';
import { FileMappingDocType } from './rxdb';

export const taskUtils = (
  getTask: TaskGetter,
  getFileMapping: (uuid: string) => Promise<FileMappingDocType | null>
) => {
  async function taskChain(taskId: string, parents = true, children = false) {
    const conversationList: string[] = [taskId];

    if (parents) {
      // Start with the selected task
      let currentTaskID = taskId;

      // Trace back the parentIDs to the original task in the chain
      while (currentTaskID) {
        // Get the current task
        const currentTask = await getTask(currentTaskID);
        if (!currentTask) break; // Break if we reach a task that doesn't exist

        // Move to the parent task
        if (currentTask.parentID) {
          currentTaskID = currentTask.parentID; // This can now be string | undefined
        } else break; // Break if we reach an "initial" task

        // Prepend the current task to the conversation list so the selected task ends up being the last in the list
        conversationList.unshift(currentTaskID);
      }
    }

    if (children) {
      // Start with the first child of the selected task
      let currentTaskID = taskId;

      // Follow the first child in the task list
      while (currentTaskID) {
        // Get the current task
        const currentTask = await getTask(currentTaskID);
        if (!currentTask) break; // Break if we reach a task that doesn't exist

        // Move to the first child task, if it exists
        if (currentTask.childrenIDs.length) {
          currentTaskID = currentTask.childrenIDs[0];
        } else break;

        // Append the current task to the conversation list
        conversationList.push(currentTaskID);
      }
    }

    return conversationList;
  }

  async function buildChatFromTask(taskId: string) {
    const openAIMessageThread = [] as OpenAI.ChatCompletionMessageParam[];
    const conversationThread = await taskChain(taskId);

    //TODO:  add instructions
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
              content: `uploaded files:\n${fileNames}`,
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
    taskChain,
    buildChatFromTask,
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
