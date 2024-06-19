import type { LLMTask, TaskGetter } from './types';
import OpenAI from 'openai';
import { dump } from 'js-yaml';
import { FileMappingDocType } from './rxdb';

export const taskUtils = (
  getTask: TaskGetter,
  getFileMapping: (uuid: string) => Promise<FileMappingDocType | null>,
  getFile: (uuid: string) => Promise<File | undefined>
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

  async function buildChatThread(taskId: string, useVisionModels: boolean) {
    const openAIMessageThread = [] as OpenAI.ChatCompletionMessageParam[];
    const taskIdChain = await getTaskIdChain(taskId);

    // instructions & prompts are added at a later stage...
    if (taskIdChain) {
      for (const mId of taskIdChain) {
        const t = await getTask(mId);
        if (t) {
          if ('functionCall' in t.content) {
            const functionContent = dump({
              arguments: t.content.functionCall.arguments,
              ...t.result?.toolResult,
            });
            const message: OpenAI.ChatCompletionMessageParam = {
              role: 'function',
              name: t.content.functionCall.name,
              content: functionContent,
            };
            openAIMessageThread.push(message);
          } else if ('functionResult' in t.content) {
            const message: OpenAI.ChatCompletionMessageParam = {
              role: 'system',
              content: dump({
                'result of the function': t.content.functionResult,
              }),
            };
            openAIMessageThread.push(message);
          } else if ('message' in t.content && t.role != 'function') {
            const message: OpenAI.ChatCompletionMessageParam = {
              role: t.role,
              content: t.content.message,
            };
            openAIMessageThread.push(message);
          } else if ('uploadedFiles' in t.content && t.role != 'function') {
            const fileMappings = await Promise.all(
              t.content.uploadedFiles.map((uuid) => getFileMapping(uuid))
            );
            const fileNames = fileMappings
              .map((fm) => '- ' + (fm?.name || fm?.opfs || 'unknown'))
              .join('\n');
            const message: OpenAI.ChatCompletionMessageParam = {
              role: t.role,
              content: `user uploaded files:\n${fileNames}`,
            };
            openAIMessageThread.push(message);

            const imageFiles = fileMappings.map((fm) => {
              fm?.fileType;
            });

            const imageMessage: OpenAI.ChatCompletionMessageParam = {
              role: 'user',
              content: [
                // TODO: we need to experiment with sending additional text here?
                //{"type": "text", "text": "What’s in this image?"},
                {
                  type: 'image_url',
                  image_url: {
                    url: 'https://upload.wikimedia.org/wikipedia/commons/thumb/d/dd/Gfp-wisconsin-madison-the-nature-boardwalk.jpg/2560px-Gfp-wisconsin-madison-the-nature-boardwalk.jpg',
                  },
                },
              ],
            };
            openAIMessageThread.push(imageMessage);
          }
        }
      }
    }
    return openAIMessageThread;
  }

  return {
    taskChain: getTaskIdChain,
    buildChatThread,
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
