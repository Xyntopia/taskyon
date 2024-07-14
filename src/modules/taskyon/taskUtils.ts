import type { TaskNode, TaskGetter } from './types';
import OpenAI from 'openai';
import { dump } from 'js-yaml';
import { FileMappingDocType } from './rxdb';

async function fileToBase64(file: File): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onloadend = () => {
      const base64String = reader.result?.toString().split(',')[1];
      if (base64String) {
        resolve(base64String);
      } else {
        reject(new Error('Failed to convert file to base64'));
      }
    };
    reader.onerror = () => {
      reject(new Error('FileReader error'));
    };
  });
}
export const taskUtils = (
  getTask: TaskGetter,
  getFileMapping: (uuid: string) => Promise<FileMappingDocType | null>,
  getFile: (uuid: string) => Promise<File | undefined>,
) => {
  /* get a chain of taskss with the last task being the last element in the list */
  async function getTaskIdChain(taskId: string) {
    const conversationList: string[] = [];

    // Start with the selected task
    let currentTaskID: string | undefined = taskId;

    // Trace back the parentIDs to the original task in the chain
    while (currentTaskID) {
      // Get the current task
      const currentTask: TaskNode | undefined = await getTask(currentTaskID);
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
            // TODO: its probably a good idea to make this shorter...
            // TODO:  not sure, if this is a good idea with OpenAI Functions...
            const functionContent = dump({
              arguments: t.content.functionCall.arguments,
              //...t.result?.toolResult,
            });
            const message: OpenAI.ChatCompletionMessageParam = {
              role: 'function',
              name: t.content.functionCall.name,
              content: functionContent,
            };
            openAIMessageThread.push(message);
          } else if ('toolResult' in t.content) {
            // we can still slightly change the content of this message to make clear
            // TODO: instead of using a manual "result of the tool" use the description in the type!
            const message: OpenAI.ChatCompletionMessageParam = {
              role: 'system',
              content: dump({
                'The tool returned the result:': t.content.toolResult,
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
              t.content.uploadedFiles.map((uuid) => getFileMapping(uuid)),
            );
            const fileNames = fileMappings
              .map((fm) => '- ' + (fm?.name || fm?.opfs || 'unknown'))
              .join('\n');
            const message: OpenAI.ChatCompletionMessageParam = {
              role: 'system',
              content: `user uploaded files:\n${fileNames}`,
            };
            openAIMessageThread.push(message);

            if (useVisionModels) {
              // build data strings for all of our images in order o send them to vision...
              const imageContent: OpenAI.ChatCompletionUserMessageParam['content'] =
                [];
              for (const fm of fileMappings) {
                if (fm) {
                  const name = fm?.name || fm?.opfs || 'unknown';
                  if (name.endsWith('png') || name.endsWith('jpg')) {
                    const file: File | undefined = await getFile(fm.uuid);
                    if (file) {
                      const base64Image = await fileToBase64(file);
                      const msgContent: OpenAI.Chat.Completions.ChatCompletionContentPartImage =
                        {
                          type: 'image_url',
                          //TODO: enable "real" image urls from another webpage ....
                          image_url: {
                            url: `data:image/jpeg;base64,${base64Image}`,
                            detail: 'auto',
                          },
                        };
                      imageContent.push(msgContent);
                    }
                  }
                }
              }

              const imageMessage: OpenAI.ChatCompletionMessageParam = {
                role: 'user',
                content: imageContent,
                // TODO: we need to experiment with sending additional text here?
                //{"type": "text", "text": "What’s in this image?"},
              };
              openAIMessageThread.push(imageMessage);
            }
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

export function findAllFilesInTasks(taskList: TaskNode[]): string[] {
  const fileSet = new Set<string>();
  taskList.forEach((task) => {
    if ('uploadedFiles' in task.content) {
      task.content.uploadedFiles.forEach((file) => fileSet.add(file));
    }
  });
  return Array.from(fileSet);
}
