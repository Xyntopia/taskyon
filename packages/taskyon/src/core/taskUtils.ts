import { usePyodideWebworker } from '../utils/webWorkerApi'
import { match, P } from 'ts-pattern'
import type { TaskNode } from '../types/taskNode'
import type { partialTaskDraft } from '../types/taskNode'

export function findAllFilesInTasks(taskList: TaskNode[]): string[] {
  const fileSet = new Set<string>()
  taskList.forEach((task) => {
    if (task.content.type === 'files') {
      task.content.data.forEach((file) => fileSet.add(file))
    }
  })
  return Array.from(fileSet)
}

const { extractKeywords } = usePyodideWebworker()

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
  const kws = await extractKeywords(chatString, 5)
  return kws
}
