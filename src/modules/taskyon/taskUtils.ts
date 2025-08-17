import type { TaskNode } from '@taskyon/taskyon'
import { partialTaskDraft } from '@taskyon/taskyon'
import { deepCopy } from '../utils'
import { safeYamlDump } from '../yamlUtils'
import { load } from 'js-yaml'
import { usePyodideWebworker } from './webWorkerApi'
import { match, P } from 'ts-pattern'

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
    } else
      throw new Error(
        `We were not able to convert ${x.data} to a task node: \n\n${JSON.stringify(x.error)}`,
      )
  })

  return tasks
}

// converts an antire taskchain (thread) into yaml
export function chatToYaml(taskList: TaskNode[]) {
  const fileContent = safeYamlDump(taskList)
  return fileContent
}

export const task2Md = (t: TaskNode, fullMeta = false) => {
  const message = t?.content.type === 'message' ? '\n\n' + t.content.data : ''

  // TODO: aso add debugging meta to this!
  // we are doing this in order to protect the "original" tasks, e.g. if they
  // are reactive... :)
  const partialTask = deepCopy(t) as Record<string, unknown>
  if (!fullMeta && partialTask) {
    // delete everything which we don't require in order
    // to create new tasks...
    delete partialTask.result
    delete partialTask.id
    delete partialTask.created_at
    delete partialTask.priorID
    if (message) delete partialTask.content
  }
  const yamlMeta = `<!--taskyon\n${safeYamlDump(partialTask)}\n-->`
  return yamlMeta + message
}

// converts an antire taskchain (thread) into markdown
export function chat2Md(taskList: TaskNode[], fullMeta = false) {
  console.log('convert Chat to markdown!')
  //convert into a list of markdown strings
  const messageStrings = taskList.map((t) => task2Md(t, fullMeta))

  return messageStrings.join('\n\n---\n\n')
}

const { extractKeywords } = usePyodideWebworker('task manager keywords')

// TODO: this should be moved into its own "NLP" tool
export async function generateTaskKeyWords(
  newTask: partialTaskDraft | undefined,
  taskChain: TaskNode[],
) {
  const chatString = [...taskChain, newTask].reduce(
    (p, n) =>
      p +
      '\n\n' +
      match(n)
        .returnType<string>()
        .with(
          {
            content: {
              type: P.union('message', 'return'),
              data: P.select(),
            },
          },
          (data) => data,
        )
        .with(
          {
            content: { type: P.union('toolresult', 'structured'), data: P.select() },
          },
          (data) => safeYamlDump(data),
        )
        .with(
          {
            content: { type: 'functioncall', data: P.select() },
          },
          (data) => safeYamlDump(data.arguments),
        )
        .otherwise(() => ''),

    '',
  )
  const kws = await extractKeywords(chatString, 5)
  return kws
}
