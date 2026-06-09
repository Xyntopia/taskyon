import { serializeObject } from '@taskyon/shared/modules/serializeObject'
import {
  escapeHtml,
  renderInlineActionButton,
  type MarkdownExtension,
} from '@taskyon/shared/modules/markdownUtils '
import type { TaskNode } from '@taskyon/taskyon'

const VARIABLE_REGEX = /{{\s*(_t:[^{}]+?)\s*}}/g

const summarizeValue = (value: unknown) =>
  serializeObject(value, {
    maxDepth: 2,
    maxArrayLength: 10,
    maxObjectKeys: 8,
    maxStringLength: 140,
  })

const renderVariableActions = (taskId: string) =>
  `<span style="display:inline-flex;gap:0.25rem;vertical-align:middle;margin-left:0.25rem;">${renderInlineActionButton(
    {
      label: 'View',
      action: 'taskyon-variable-open',
      payload: { taskId },
      className: 'taskyon-inline-action',
      title: 'Inspect variable',
    },
  )}</span>`

const renderStringVariable = (value: string, taskId: string) =>
  `<span style="display:inline;white-space:pre-wrap;">${escapeHtml(value)}</span><span style="display:inline-block;margin-left:0.25rem;font-size:0.8em;opacity:0.7;">[var]</span>${renderVariableActions(taskId)}`

const renderStructuredVariable = (value: unknown, taskId: string) =>
  `<span style="display:inline-block;max-width:100%;vertical-align:middle;padding:0.1rem 0.35rem;border-radius:0.35rem;background:rgba(127,127,127,0.12);"><code>${escapeHtml(summarizeValue(value))}</code></span>${renderVariableActions(taskId)}`

export const createTaskMarkdownExtension = (
  getTaskById: (taskId: string) => Promise<TaskNode | null | undefined>,
): MarkdownExtension => ({
  name: 'taskyon-variables',
  preprocess: async (src) => {
    const matches = Array.from(src.matchAll(VARIABLE_REGEX))
    if (matches.length === 0) return src

    let output = src
    for (const match of matches) {
      const rawRef = match[1]?.trim() ?? ''
      const taskId = rawRef.startsWith('_t:') ? rawRef.slice(3) : ''
      if (!taskId) continue
      const task = await getTaskById(taskId)
      if (!task) continue
      const replacement =
        typeof task.content.data === 'string'
          ? renderStringVariable(task.content.data, taskId)
          : renderStructuredVariable(task.content.data, taskId)
      output = output.replace(match[0], replacement)
    }

    return { src: output, allowHtml: true }
  },
})
