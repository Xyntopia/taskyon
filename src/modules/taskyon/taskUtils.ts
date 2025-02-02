import type { TaskNode, TaskGetter, partialTaskDraft } from './types'
import { load } from 'js-yaml'

export const taskUtils = (getTask: TaskGetter) => {
  /* get a chain of taskss with the last task being the last element in the list */
  async function getTaskIdChain(taskId: string, maxFollow: number = 0) {
    const conversationList: string[] = []

    // Start with the selected task
    let currentTaskID: string | undefined = taskId

    // Trace back the priorIDs to the original task in the chain
    while (currentTaskID && (maxFollow >= conversationList.length || maxFollow == 0)) {
      // Get the current task
      const currentTask: TaskNode | undefined = await getTask(currentTaskID)
      if (currentTask) {
        // Prepend the current task to the conversation list so the selected task ends up being the last in the list
        conversationList.unshift(currentTaskID)
        currentTaskID = currentTask.priorID
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

  return {
    getTaskIdChain,
    getTaskChain,
  }
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
