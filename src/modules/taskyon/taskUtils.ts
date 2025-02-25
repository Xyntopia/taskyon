import { type TaskNode, partialTaskDraft } from './types'
import { load } from 'js-yaml'

export function findAllFilesInTasks(taskList: TaskNode[]): string[] {
  const fileSet = new Set<string>()
  taskList.forEach((task) => {
    if (task.content.type === 'files') {
      task.content.data.forEach((file) => fileSet.add(file))
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
