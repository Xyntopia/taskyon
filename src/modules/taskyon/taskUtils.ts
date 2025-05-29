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
  const fileURL = folder ? `/${folder}/${filePath}` : `/${filePath}`
  const response = await fetch(fileURL)

  // Check if the response is not OK or if the content type is HTML (indicating 404 page)
  const contentType = response.headers.get('Content-Type') || ''
  if (!response.ok || contentType.includes('text/html')) {
    throw new Error(`Failed to load markdown file: ${fileURL}`)
  }

  const text = await response.text()
  return text
}

// Fetch, split, and parse the markdown file
export function processMarkdown(markdown: string) {
  console.log('add new tasks', markdown)
  // Split the markdown content by the separator
  const messages = markdown.split(/---(?=\s*<!--taskyon)/g).map((message) => message.trim())

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
    const taskDraft: Partial<partialTaskDraft> = {
      content: { type: 'message', data: content },
      ...metadata,
    }
    // make sure we really hav all data we need (role!!)
    const task = partialTaskDraft.safeParse(taskDraft)
    return task
  })

  const tasks = parsedData.map((x): partialTaskDraft => {
    if (x.success) {
      return x.data
    } else {
      return {
        role: 'system',
        content: {
          type: 'error',
          data: `We were not able to convert ${x.data} to a task node: \n\n${JSON.stringify(x.error)}`,
        },
      }
    }
  })

  return tasks
}
