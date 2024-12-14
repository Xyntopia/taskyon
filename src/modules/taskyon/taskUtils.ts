import type { TaskNode, TaskGetter, ToolBase } from './types'
import type OpenAI from 'openai'
import { dump } from 'js-yaml'
import { type FileMappingDocType } from './rxdb'
import { load } from 'js-yaml'
import { partialTaskDraft } from 'src/modules/taskyon/types'

async function fileToBase64(file: File): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.readAsDataURL(file)
    reader.onloadend = () => {
      const base64String = reader.result?.toString().split(',')[1]
      if (base64String) {
        resolve(base64String)
      } else {
        reject(new Error('Failed to convert file to base64'))
      }
    }
    reader.onerror = () => {
      reject(new Error('FileReader error'))
    }
  })
}

export const taskUtils = (
  getTask: TaskGetter,
  getFileMapping: (uuid: string) => Promise<FileMappingDocType | null>,
  getFile: (uuid: string) => Promise<File | undefined>,
) => {
  /* get a chain of taskss with the last task being the last element in the list */
  async function getTaskIdChain(taskId: string, maxFollow: number = 0) {
    const conversationList: string[] = []

    // Start with the selected task
    let currentTaskID: string | undefined = taskId

    // Trace back the parentIDs to the original task in the chain
    while (currentTaskID && (maxFollow >= conversationList.length || maxFollow == 0)) {
      // Get the current task
      const currentTask: TaskNode | undefined = await getTask(currentTaskID)
      if (currentTask) {
        // Prepend the current task to the conversation list so the selected task ends up being the last in the list
        conversationList.unshift(currentTaskID)
        currentTaskID = currentTask.parentID
      } else {
        currentTaskID = undefined
      } // Break if we reach a task that doesn't exist
    }

    return conversationList
  }

  async function getTaskChain(taskId: string) {
    const taskIds = await getTaskIdChain(taskId)
    const taskList = await Promise.all(taskIds.map((tid) => getTask(tid)))
    return taskList
  }

  // TODO: combine this function with follow-up tasks & prompCreation...
  //      there are too many places, where we do this stuff ;)
  async function buildChatThread(
    taskId: string,
    useVisionModels: boolean,
    toolCollection: Record<string, ToolBase>,
    useOpenAITools: boolean,
  ) {
    const openAIMessageThread = [] as OpenAI.ChatCompletionMessageParam[]
    const taskIdChain = await getTaskIdChain(taskId)

    if (taskIdChain) {
      // we are using the reverse, because we want to build the chain starting
      // from the lsat message, so that we have to add e.g. function descriptions etc...
      // only once..
      for (const mId of taskIdChain) {
        const task = await getTask(mId)
        if (task) {
          const messages = await convertTaskNodeToOpenAIMessage(
            task,
            useVisionModels,
            getFileMapping,
            getFile,
            useOpenAITools,
          )
          if (messages) openAIMessageThread.push(...messages)
        }
      }
    }

    return openAIMessageThread
  }

  return {
    getTaskIdChain,
    buildChatThread,
    getTaskChain,
  }
}

// sometimes a single task can get converted to multiple messages
// and sometime we don't need it at all in the chat :)
async function convertTaskNodeToOpenAIMessage(
  task: TaskNode,
  useVisionModels: boolean,
  getFileMapping: (uuid: string) => Promise<FileMappingDocType | null>,
  getFile: (uuid: string) => Promise<File | undefined>,
  useOpenAITools: boolean,
): Promise<OpenAI.Chat.Completions.ChatCompletionMessageParam[] | undefined> {
  if ('functionCall' in task.content) {
    if (useOpenAITools) {
      const functionMessage: OpenAI.ChatCompletionMessageParam = {
        role: 'assistant',
        content: null,
        tool_calls: [
          {
            id: task.id,
            type: 'function',
            function: {
              name: task.content.functionCall.name,
              arguments: JSON.stringify(task.content.functionCall.arguments),
            },
          },
        ],
      }
      return [functionMessage]
    } else {
      // the purpose of this is to inform the AI about what function was called and
      // the arguments in it.
      // TODO: its probably a good idea to make this shorter in cas we have very long argumets...
      // TODO: not sure, if this is a good idea with OpenAI Functions, bcause openai seems to already have
      //       an idea about the functions which were provided with their descriptions,
      //       anyways So we should probably leave this out here...
      const functionCallName = task.content.functionCall.name

      const functionArgs = dump({
        arguments: task.content.functionCall.arguments,
        //...t.result?.toolResult,
      })
      return [
        {
          role: 'assistant',
          // and the result of the function
          content: `I just used the following tool: ${functionCallName}. The parameters used were: ${functionArgs}`,
        },
      ]
    }
  } else if ('toolResult' in task.content) {
    // we can still slightly change the content of this message to make clear
    // TODO: instead of using a manual "result of the tool" use the description in the type!
    // maybe refer to the actual tool call here?
    if (task.parentID && useOpenAITools) {
      const message: OpenAI.ChatCompletionMessageParam = {
        role: 'tool',
        tool_call_id: task.parentID, // the tool call will get the parent ID as well! :)
        content: dump(task.content.toolResult),
      }
      return [message]
    } else
      return [
        {
          role: 'assistant',
          content: dump({
            'The tool that you called returned the following result:': task.content.toolResult,
          }),
        },
      ]
  } else if ('message' in task.content && task.role != 'function') {
    const message: OpenAI.ChatCompletionMessageParam = {
      role: task.role,
      content: task.content.message,
    }
    return [message]
  } else if ('uploadedFiles' in task.content && task.role != 'function') {
    const fileMappings = await Promise.all(
      task.content.uploadedFiles.map((uuid) => getFileMapping(uuid)),
    )
    const fileNames = fileMappings
      .map((fm) => '- ' + (fm?.name || fm?.opfs || 'unknown'))
      .join('\n')
    const message: OpenAI.ChatCompletionMessageParam = {
      role: 'system',
      content: `user uploaded files:\n${fileNames}`,
    }

    if (useVisionModels) {
      // build data strings for all of our images in order to send them to vision...
      const imageContent: OpenAI.ChatCompletionUserMessageParam['content'] =
        await convertFilesToOpenAIImageContent(fileMappings, getFile)

      const imageMessage: OpenAI.ChatCompletionMessageParam = {
        role: 'user',
        content: imageContent,
        // TODO: we need to experiment with sending additional text here?
        //{"type": "text", "text": "What’s in this image?"},
      }
      return [message, imageMessage]
    }
    return [message]
  }
  // TODO: we would also like to convert structured messages, and simply don't send them to
  //       the chat, if they're configured as "lower-hierarchy"
}

async function convertFilesToOpenAIImageContent(
  fileMappings: (FileMappingDocType | null)[],
  getFile: (uuid: string) => Promise<File | undefined>,
) {
  const imageContent: OpenAI.ChatCompletionUserMessageParam['content'] = []
  for (const fm of fileMappings) {
    if (fm) {
      const name = fm?.name || fm?.opfs || 'unknown'
      if (name.endsWith('png') || name.endsWith('jpg')) {
        const file: File | undefined = await getFile(fm.uuid)
        if (file) {
          const base64Image = await fileToBase64(file)
          const msgContent: OpenAI.Chat.Completions.ChatCompletionContentPartImage = {
            type: 'image_url',
            //TODO: enable "real" image urls from another webpage ....
            image_url: {
              url: `data:image/jpeg;base64,${base64Image}`,
              detail: 'auto',
            },
          }
          imageContent.push(msgContent)
        }
      }
    }
  }
  return imageContent
}

export function findAllFilesInTasks(taskList: TaskNode[]): string[] {
  const fileSet = new Set<string>()
  taskList.forEach((task) => {
    if ('uploadedFiles' in task.content) {
      task.content.uploadedFiles.forEach((file) => fileSet.add(file))
    }
  })
  return Array.from(fileSet)
}

export async function getTextFile(url: URL | string) {
  // Fetch the markdown file from the URL
  const response = await fetch(url)
  if (!response.ok) {
    throw new Error(`Failed to fetch text file: ${response.statusText}`)
  }
  const mdString = await response.text()
  return mdString
}

export const fetchMarkdown = async (folder: string, filePath: string) => {
  try {
    const fileURL = folder ? `/${folder}/${filePath}` : `/${filePath}`
    const response = await fetch(fileURL)
    if (!response.ok) {
      throw new Error(`Failed to load ${fileURL}`)
    }
    const text = await response.text()
    return text
  } catch (error) {
    console.error(error)
  }
}

// Fetch, split, and parse the markdown file
export function processMarkdown(markdown: string) {
  console.log('add new tasks', markdown)
  // Split the markdown content by the separator
  const messages = markdown.split(/^---/gm).map((message) => message.trim())

  // Regular expression for matching metadata
  const metadataRegex = /<!--taskyon([\s\S]*?)-->/

  // Extract metadata and content from each message
  const parsedData = messages.map((message) => {
    const metadataMatch = metadataRegex.exec(message)
    let metadata
    if (metadataMatch && metadataMatch[1]) {
      metadata = (metadataMatch ? load(metadataMatch[1].trim()) : {}) as Record<string, unknown>
    } else {
      metadata = {
        role: 'user',
      }
    }
    const content = message.replace(metadataRegex, '').trim()
    const task = partialTaskDraft.safeParse({
      content: { message: content },
      ...metadata,
    })
    return task
  })

  const tasks = parsedData
    .filter((x): x is (typeof parsedData)[0] & { success: true } => x.success)
    .map((x) => x.data)

  return tasks
}
