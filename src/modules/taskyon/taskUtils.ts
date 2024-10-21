import type { TaskNode, TaskGetter, ToolBase } from './types';
import type OpenAI from 'openai';
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
  async function getTaskIdChain(taskId: string, maxFollow: number = 0) {
    const conversationList: string[] = [];

    // Start with the selected task
    let currentTaskID: string | undefined = taskId;

    // Trace back the parentIDs to the original task in the chain
    while (
      currentTaskID &&
      (maxFollow >= conversationList.length || maxFollow == 0)
    ) {
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

  // TODO: combine this function with follow-up tasks & prompCreation...
  //      there are too many places, where we do this stuff ;)
  async function buildChatThread(
    taskId: string,
    useVisionModels: boolean,
    toolCollection: Record<string, ToolBase>,
    useOpenAITools: boolean,
    removeDuplicateDescriptions = true,
  ) {
    const openAIMessageThread = [] as OpenAI.ChatCompletionMessageParam[];
    const taskIdChain = await getTaskIdChain(taskId);
    const functionCallDescriptions = new Set<string>();

    if (taskIdChain) {
      // we are using the reverse, because we want to build the chain starting
      // from the lsat message, so that we have to add e.g. function descriptions etc...
      // only once..
      for (const mId of taskIdChain) {
        const task = await getTask(mId);
        if (task) {
          const messages = await convertTaskNodeToOpenAIMessage(
            task,
            useVisionModels,
            getFileMapping,
            getFile,
            useOpenAITools,
          );
          if (messages) openAIMessageThread.push(...messages);
        }
      }
    }

    // Optionally remove duplicate messages except the last one
    if (removeDuplicateDescriptions) {
      const reversedThread = [...openAIMessageThread].reverse();
      const seenDescriptions = new Set<string>();
      const deduplicatedThread = reversedThread.filter((message) => {
        if (
          message.role === 'system' &&
          typeof message.content === 'string' &&
          functionCallDescriptions.has(message.content)
        ) {
          if (seenDescriptions.has(message.content)) {
            return false; // Skip duplicates
          }
          seenDescriptions.add(message.content);
        }
        return true;
      });
      return deduplicatedThread.reverse(); // Reverse back to original order
    }

    return openAIMessageThread;
  }

  return {
    getTaskIdChain,
    buildChatThread,
    getTaskChain,
  };
};

// sometimes a single task can get converted to multiple messages
// and sometime we don't need it at all in the chat :)
async function convertTaskNodeToOpenAIMessage(
  task: TaskNode,
  useVisionModels: boolean,
  getFileMapping: (uuid: string) => Promise<FileMappingDocType | null>,
  getFile: (uuid: string) => Promise<File | undefined>,
  getTask: TaskGetter,
  useOpenAITools: boolean,
): Promise<OpenAI.Chat.Completions.ChatCompletionMessageParam[] | undefined> {
  if ('functionCall' in task.content) {
    // the purpose of this is to inform the AI about what function was called and
    // the arguments in it.
    // TODO: its probably a good idea to make this shorter in cas we have very long argumets...
    // TODO: not sure, if this is a good idea with OpenAI Functions, bcause openai seems to already have
    //       an idea about the functions which were provided with their descriptions,
    //       anyways So we should probably leave this out here...
    const functionCallName = task.content.functionCall.name;

    // and the result of the function
    const functionContent = dump({
      arguments: task.content.functionCall.arguments,
      //...t.result?.toolResult,
    });
    const msg = `I just used the following tool: ${functionCallName}. The parameters used were: ${functionContent}`;
    const functionMessage: OpenAI.ChatCompletionMessageParam = useOpenAITools
      ? {
          role: 'tool',
          tool_call_id: functionCallName,
          content: msg,
        }
      : { role: 'assistant', content: msg };
    return [functionMessage];
  } else if ('toolResult' in task.content) {
    // we can still slightly change the content of this message to make clear
    // TODO: instead of using a manual "result of the tool" use the description in the type!
    // maybe refer to the actual tool call here?
    if (task.parentID && useOpenAITools) {
      const parentTask = await getTask(task.parentID);
      if (parentTask?.content && 'functionCall' in parentTask.content) {
        const toolName = parentTask?.content.functionCall.name;
        const message: OpenAI.ChatCompletionMessageParam = {
          role: 'tool',
          tool_call_id: toolName,
          content: dump({
            'The tool that you called returned the following result:':
              task.content.toolResult,
          }),
        };
        return [message];
      }
    } else
      return [
        {
          role: 'assistant',
          content: dump({
            'The tool that you called returned the following result:':
              task.content.toolResult,
          }),
        },
      ];
  } else if ('message' in task.content && task.role != 'function') {
    const message: OpenAI.ChatCompletionMessageParam = {
      role: task.role,
      content: task.content.message,
    };
    return [message];
  } else if ('uploadedFiles' in task.content && task.role != 'function') {
    const fileMappings = await Promise.all(
      task.content.uploadedFiles.map((uuid) => getFileMapping(uuid)),
    );
    const fileNames = fileMappings
      .map((fm) => '- ' + (fm?.name || fm?.opfs || 'unknown'))
      .join('\n');
    const message: OpenAI.ChatCompletionMessageParam = {
      role: 'system',
      content: `user uploaded files:\n${fileNames}`,
    };

    if (useVisionModels) {
      // build data strings for all of our images in order to send them to vision...
      const imageContent: OpenAI.ChatCompletionUserMessageParam['content'] =
        await convertFilesToOpenAIImageContent(fileMappings, getFile);

      const imageMessage: OpenAI.ChatCompletionMessageParam = {
        role: 'user',
        content: imageContent,
        // TODO: we need to experiment with sending additional text here?
        //{"type": "text", "text": "What’s in this image?"},
      };
      return [message, imageMessage];
    }
    return [message];
  }
  // TODO: we would also like to convert structured messages, and simply don't send them to
  //       the chat, if they're configured as "lower-hierarchy"
}

async function convertFilesToOpenAIImageContent(
  fileMappings: (FileMappingDocType | null)[],
  getFile: (uuid: string) => Promise<File | undefined>,
) {
  const imageContent: OpenAI.ChatCompletionUserMessageParam['content'] = [];
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
  return imageContent;
}

export function findAllFilesInTasks(taskList: TaskNode[]): string[] {
  const fileSet = new Set<string>();
  taskList.forEach((task) => {
    if ('uploadedFiles' in task.content) {
      task.content.uploadedFiles.forEach((file) => fileSet.add(file));
    }
  });
  return Array.from(fileSet);
}
