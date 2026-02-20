// modelicaTools.ts

import { createChatCompletionTask, createTool, makeTaskResult } from '@taskyon/taskyon'
import type { JSONSchema7 } from 'json-schema'
import { Notify } from 'quasar'
import { type Ref } from 'vue'

/**
 * Tools
 *
 * We mirror the CodingPage approach:
 *  - modelicaDocumentAssistant: assembles prompt context with line numbers
 *  - updateModelicaDocument: applies line-based patches and creates version snapshots
 */

type ModelicaFilePath = 'modelica' | 'template' | 'uiTemplate' | 'solver'

type LinePatchOperation = {
  type: 'replace' | 'insert' | 'delete'
  lineStart: number
  lineEnd?: number
  text?: string
}

// --- Helper functions for line-based patching ---

function formatContentWithLineNumbers(content: string): string {
  const lines = (content ?? '').split('\n')
  return lines
    .map((line, index) => {
      const lineNum = (index + 1).toString().padStart(4, ' ')
      return `${lineNum}: ${line}`
    })
    .join('\n')
}

function applyLinePatches(text: string, patches: LinePatchOperation[]): string {
  const lines = (text ?? '').split('\n')
  const sortedPatches = [...patches].sort((a, b) => b.lineStart - a.lineStart)

  for (const patch of sortedPatches) {
    const startIdx = patch.lineStart - 1
    if (startIdx < 0) continue

    if (patch.type === 'insert') {
      const newLines = (patch.text || '').split('\n')
      lines.splice(startIdx, 0, ...newLines)
      continue
    }

    const endLine = patch.lineEnd ?? patch.lineStart
    const deleteCount = endLine - patch.lineStart + 1

    if (patch.type === 'delete') {
      lines.splice(startIdx, deleteCount)
    } else if (patch.type === 'replace') {
      const newLines = (patch.text || '').split('\n')
      lines.splice(startIdx, deleteCount, ...newLines)
    }
  }

  return lines.join('\n')
}

export const createModelicatools = ({
  modelicaSource,
  templateSource,
  uiTemplateSource,
  solverSource,
  jsSource,
  daePrettyOutput,
  modelicaLog,
  simT0,
  simTf,
  simDt,
  showAllInPrompt,
  createNewVersion,
}: {
  modelicaSource: Ref<string>
  templateSource: Ref<string>
  uiTemplateSource: Ref<string>
  solverSource: Ref<string>
  jsSource: Ref<string>
  daePrettyOutput: Ref<string>
  modelicaLog: Ref<{ timestamp: string; level: string; message: string }[]>
  simT0: Ref<number>
  simTf: Ref<number>
  simDt: Ref<number>
  showAllInPrompt: Ref<boolean>
  createNewVersion: (description?: string) => void
}) => [
  createTool({
    name: 'modelicaDocumentAssistant',
    description:
      'Main assistant that inspects the current Modelica and template sources and decides on edits.',
    parameters: {
      type: 'object',
      properties: {
        showAll: {
          type: 'boolean',
          description:
            'If true, include the full contents of both Modelica and template (with line numbers). If false, include only Modelica in full.',
        },
      },
      additionalProperties: false,
    } as const satisfies JSONSchema7,
    function: (opts) => {
      const showAll = opts.showAll ?? showAllInPrompt.value ?? true

      const modelicaWithLines = formatContentWithLineNumbers(modelicaSource.value)
      const templateWithLines = formatContentWithLineNumbers(templateSource.value)
      const uiTemplateWithLines = formatContentWithLineNumbers(uiTemplateSource.value)
      const solverWithLines = formatContentWithLineNumbers(solverSource.value)

      const sourcesSection = showAll
        ? `## Modelica Source\n\n\
\
\
\`\`\`\n${modelicaWithLines}\n\`\`\`\n\n## Template Source\n\n\`\`\`\n${templateWithLines}\n\`\`\`\n\n## UI Template Source\n\n\`\`\`\n${uiTemplateWithLines}\n\`\`\`\n\n## Solver Source\n\n\`\`\`\n${solverWithLines}\n\`\`\``
        : `## Modelica Source\n\n\`\`\`\n${modelicaWithLines}\n\`\`\`\n\n## Template Source\n\nTemplate source is hidden because showAll is false.\n\n## UI Template Source\n\nUI template source is hidden because showAll is false.\n\n## Solver Source\n\nSolver source is hidden because showAll is false.`

      const contextPrompt = `
You are the Taskyon Modelica assistant.

You can edit two documents:
- Modelica source
- Jinja template source

The UI shows the results live.

${sourcesSection}

## Generated JavaScript
\`\`\`\n${jsSource.value}\n\`\`\`

## Pretty DAE
\`\`\`\n${daePrettyOutput.value}\n\`\`\`

## Recent logs
\`\`\`\n${JSON.stringify(modelicaLog.value.slice(-30), null, 2)}\n\`\`\`

## Simulation settings
\`\`\`\n${JSON.stringify({ t0: simT0.value, tf: simTf.value, dt: simDt.value }, null, 2)}\n\`\`\`

## Available Tool: updateModelicaDocument
- Apply line-based patches to modelica or template.
- You can update both in a single call.

## CRITICAL BEHAVIOR RULES
1. For any edit request, you MUST call updateModelicaDocument. Prefer patches.
2. Do not include line numbers in patch text.
3. Do NOT set newContent to an empty string. Omit newContent unless you intend a full replacement.
4. If uncertain, ask 1–2 clarification questions.
5. If compilation is failing, you may attempt one follow-up edit at most, preferring Modelica changes first.
`

      return makeTaskResult([
        createChatCompletionTask({
          prompts: [contextPrompt],
          goal: 'ChooseTool',
          allowedTools: ['updateModelicaDocument'],
        }),
      ])
    },
  }),

  createTool({
    name: 'updateModelicaDocument',
    description:
      'Apply line-based updates to Modelica and or template and create a version snapshot.',
    parameters: {
      type: 'object',
      properties: {
        updates: {
          type: 'array',
          description: 'Updates to apply. You can patch both modelica and template in one call.',
          items: {
            type: 'object',
            properties: {
              filePath: {
                type: 'string',
                enum: ['modelica', 'template', 'uiTemplate', 'solver'],
              },
              patches: {
                type: 'array',
                description:
                  'Line-based patch operations. Lines are 1-based indexed. Do not overlap patches.',
                items: {
                  type: 'object',
                  properties: {
                    type: { enum: ['replace', 'insert', 'delete'], type: 'string' },
                    lineStart: { type: 'number' },
                    lineEnd: { type: 'number' },
                    text: { type: 'string' },
                  },
                  required: ['type', 'lineStart'],
                },
              },
              newContent: {
                type: 'string',
                description: 'Replace full content. Only do this if patching is not feasible.',
              },
            },
            required: ['filePath'],
            additionalProperties: false,
          },
        },
        description: { type: 'string', description: 'Summary of changes' },
      },
      required: ['updates'],
      additionalProperties: false,
    } as const satisfies JSONSchema7,
    function: ({ updates, description }) => {
      const totalEdits = updates.reduce((acc, update) => {
        const patchCount = Array.isArray(update.patches) ? update.patches.length : 0
        const newContentStr = typeof update.newContent === 'string' ? update.newContent : ''
        const hasMeaningfulNewContent = newContentStr.trim().length > 0
        return acc + patchCount + (hasMeaningfulNewContent ? 1 : 0)
      }, 0)

      if (totalEdits === 0) {
        Notify.create({
          type: 'warning',
          message: 'No edits provided in updateModelicaDocument call',
        })
        return makeTaskResult([
          createChatCompletionTask({
            prompts: [
              'You called updateModelicaDocument but did not provide any patches or newContent. Provide edits or do not call the tool.',
            ],
            goal: 'ChooseTool',
            allowedTools: ['updateModelicaDocument'],
          }),
        ])
      }

      // Merge updates by filePath to enforce stable application.
      // Safety: ignore empty-string newContent to prevent accidental wiping.
      const mergedUpdates = updates.reduce(
        (acc, update) => {
          const key = update.filePath as ModelicaFilePath
          const existing = acc[key]

          const incomingNewContent =
            typeof update.newContent === 'string' ? update.newContent : undefined
          const hasIncomingNewContent =
            typeof incomingNewContent === 'string' && incomingNewContent.trim().length > 0
          const incomingPatches = Array.isArray(update.patches) ? update.patches : []

          if (existing) {
            if (hasIncomingNewContent) existing.newContent = incomingNewContent
            existing.patches = [...(existing.patches || []), ...incomingPatches]
          } else {
            acc[key] = {
              filePath: key,
              newContent: hasIncomingNewContent ? incomingNewContent : undefined,
              patches: incomingPatches,
            } as (typeof updates)[0]
          }
          return acc
        },
        {} as Record<ModelicaFilePath, (typeof updates)[0]>,
      )

      const beforeModelica = modelicaSource.value
      const beforeTemplate = templateSource.value
      const beforeUiTemplate = uiTemplateSource.value
      const beforeSolver = solverSource.value
      const changesLog: string[] = []

      for (const [filePath, update] of Object.entries(mergedUpdates) as [
        ModelicaFilePath,
        (typeof updates)[0],
      ][]) {
        const originalContent =
          filePath === 'modelica'
            ? beforeModelica
            : filePath === 'template'
              ? beforeTemplate
              : filePath === 'uiTemplate'
                ? beforeUiTemplate
                : beforeSolver
        let updatedContent = originalContent

        const hasNewContent =
          typeof update.newContent === 'string' && update.newContent.trim().length > 0

        if (hasNewContent) {
          updatedContent = update.newContent as string
          changesLog.push(`Replaced content of ${filePath}`)
        }

        if (update.patches && update.patches.length > 0) {
          updatedContent = applyLinePatches(updatedContent, update.patches as LinePatchOperation[])
          changesLog.push(`Patched ${filePath} (${update.patches.length} ops)`)
        }

        if (filePath === 'modelica') modelicaSource.value = updatedContent
        if (filePath === 'template') templateSource.value = updatedContent
        if (filePath === 'uiTemplate') uiTemplateSource.value = updatedContent
        if (filePath === 'solver') solverSource.value = updatedContent
      }

      createNewVersion(`AI update: ${description || changesLog.join(', ')}`)

      return makeTaskResult([
        {
          role: 'system',
          content: {
            type: 'message',
            data: `Updates applied:\n${changesLog.join('\n')}`,
          },
        },
        ...(description
          ? [
              {
                role: 'system' as const,
                content: { type: 'message' as const, data: description },
              },
            ]
          : []),
      ])
    },
  }),
]
