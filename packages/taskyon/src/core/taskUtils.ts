import { match, P } from 'ts-pattern'
import type { TaskNode } from '../types/taskNode'
import type { partialTaskDraft } from '../types/taskNode'
import { generateTaskName, type TaskNameOptions } from './taskNaming'

export function findAllFilesInTasks(taskList: TaskNode[]): string[] {
  const fileSet = new Set<string>()
  taskList.forEach((task) => {
    if (task.content.type === 'files') {
      task.content.data.forEach((file) => fileSet.add(file))
    }
  })
  return Array.from(fileSet)
}

export type GenerateTaskKeywordsOptions = Partial<TaskNameOptions>

export function taskChainTextForNaming(
  newTask: partialTaskDraft | undefined,
  taskChain: TaskNode[],
): string {
  return [...taskChain, newTask].reduce(
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
        // TODO: analyze tools for keywords..
        // main issue here is, that we have some tools that are very repetitive. e.g.
        // the choosetool tool so we are leacing this out for now until we have found a better solution
        // e.g. we should probably not use chatCOmpletion and tooltool and similar ones for
        // keyword extraction.  probably use the "display" property in order to choose which ones to use
        // and which ones not...
        /*.with(
          {
            content: { type: 'functioncall', data: P.select() },
          },
          (data) => safeYamlDump(data.arguments),
        ).with(
          {
            content: { type: P.union('structured'), data: P.select() },
          },
          (data) => safeYamlDump(data),
        )
          */
        .otherwise(() => ''),

    '',
  )
}

// Compatibility wrapper for existing task naming call sites.
export async function generateTaskKeyWords(
  newTask: partialTaskDraft | undefined,
  taskChain: TaskNode[],
  options: GenerateTaskKeywordsOptions = {},
) {
  const name = await generateTaskName({
    text: taskChainTextForNaming(newTask, taskChain),
    options: {
      mode: options.mode ?? 'first-words',
      maxWords: options.maxWords ?? 4,
      maxChars: options.maxChars ?? 50,
    },
  })
  return name ? [name] : []
}
