// modelicaTools.ts

import { createChatCompletionTask, createTool, toolCall } from '@taskyon/tyclient'
import type { JSONSchema7 } from 'json-schema'
import { Notify } from 'quasar'
import { serializeObject } from '../modules/serializeObject'
import { type Ref } from 'vue'

/**
 * Tools
 *
 * We mirror the CodingPage approach:
 *  - modelicaDocumentAssistant: assembles prompt context with line numbers
 *  - updateModelicaDocument: applies line-based patches and creates version snapshots
 */

type ModelicaFilePath = 'modelica' | 'template' | 'uiTemplate' | 'solver'
type ModelicaLogEntry = {
  timestamp: string
  level: string
  message: string
  phase?: string
  details?: unknown
}

type LinePatchOperation = {
  type: 'replace' | 'insert' | 'delete'
  lineStart: number
  lineEnd?: number
  text?: string
}

type ModelicaDocumentUpdate = {
  filePath: ModelicaFilePath
  patches?: LinePatchOperation[]
  newContent?: string
}

const MODELICA_AGENT_SERIALIZE_OPTIONS = {
  format: 'json' as const,
  maxDepth: 6,
  maxArrayLength: 25,
  maxObjectKeys: 30,
  maxStringLength: 800,
  indent: 2,
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

function extractCompileStatus(logs: ModelicaLogEntry[]) {
  const recent = logs.slice(-120)
  const taggedCompileLogs = recent.filter((entry) => {
    const phase = String(entry.phase || '')
    if (phase === 'compile' || phase === 'abi') return true
    const msg = String(entry.message || '')
    return (
      msg.includes('Compilation successful') ||
      msg.includes('Compilation failed:') ||
      msg.includes('Model() construction probe failed') ||
      msg.includes('Generated model ABI validation failed') ||
      msg.includes('Template error')
    )
  })

  const lastSuccess = [...taggedCompileLogs]
    .reverse()
    .find((entry) => String(entry.message || '').includes('Compilation successful'))
  const lastFailure = [...taggedCompileLogs]
    .reverse()
    .find(
      (entry) =>
        String(entry.message || '').includes('Compilation failed:') ||
        String(entry.message || '').includes('Model() construction probe failed') ||
        String(entry.message || '').includes('Generated model ABI validation failed') ||
        String(entry.message || '').includes('Template error'),
    )

  const idxSuccess = lastSuccess ? taggedCompileLogs.lastIndexOf(lastSuccess) : -1
  const idxFailure = lastFailure ? taggedCompileLogs.lastIndexOf(lastFailure) : -1
  const state = idxSuccess > idxFailure ? 'success' : idxFailure > idxSuccess ? 'error' : 'unknown'

  return {
    state,
    lastSuccess,
    lastFailure,
    recentCompileLogs: taggedCompileLogs.slice(-20),
  }
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
  compileNow,
}: {
  modelicaSource: Ref<string>
  templateSource: Ref<string>
  uiTemplateSource: Ref<string>
  solverSource: Ref<string>
  jsSource: Ref<string>
  daePrettyOutput: Ref<string>
  modelicaLog: Ref<ModelicaLogEntry[]>
  simT0: Ref<number>
  simTf: Ref<number>
  simDt: Ref<number>
  showAllInPrompt: Ref<boolean>
  createNewVersion: (description?: string) => void
  compileNow?: () => Promise<{ ok: boolean; message?: string }>
}) => [
  createTool({
    name: 'modelicaDocumentAssistant',
    description:
      'Main assistant that inspects the current Modelica and template sources and decides on edits.',
    parameters: {
      type: 'object',
      properties: {
        useTools: {
          type: 'boolean',
          description: 'When true, allow the assistant to run autonomous tool workflows.',
          default: true,
        },
        showAll: {
          type: 'boolean',
          description:
            'If true, include the full contents of both Modelica and template (with line numbers). If false, include only Modelica in full.',
        },
      },
      additionalProperties: false,
    } as const satisfies JSONSchema7,
    function: (opts, ctx) => {
      const useTools = opts.useTools ?? true
      const showAll = opts.showAll ?? showAllInPrompt.value ?? true
      const compileStatus = extractCompileStatus(modelicaLog.value || [])
      const compileLooksBroken = compileStatus.state === 'error'

      if (useTools && compileLooksBroken) {
        return ctx.createSubtasksResult([
          {
            role: 'assistant',
            content: {
              type: 'message',
              data: 'Compilation error detected. Starting autonomous compile-fix cycle now.',
            },
          },
          toolCall({
            name: 'autoFixModelicaCompilationCycle',
            arguments: {
              currentRound: 1,
              maxRounds: 5,
              showAll,
            },
          }),
        ])
      }

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

You can edit these documents:
- Modelica source
- Jinja template source
- UI template source
- Solver source

The UI shows the results live.

${sourcesSection}

## Generated JavaScript
\`\`\`\n${jsSource.value}\n\`\`\`

## Base DAE
\`\`\`\n${daePrettyOutput.value}\n\`\`\`

## Recent logs
\`\`\`\n${serializeObject(modelicaLog.value.slice(-30), MODELICA_AGENT_SERIALIZE_OPTIONS)}\n\`\`\`

## Simulation settings
\`\`\`\n${serializeObject(
        { t0: simT0.value, tf: simTf.value, dt: simDt.value },
        MODELICA_AGENT_SERIALIZE_OPTIONS,
      )}\n\`\`\`

## Available Tool: updateModelicaDocument
- Apply line-based patches to modelica or template.
- You can update both in a single call.

## Additional tools
- getModelicaCompilerStatus: inspect the latest compile/ABI state.
- autoFixModelicaCompilationCycle: autonomous patch->compile->check loop.

## CRITICAL BEHAVIOR RULES
1. For any edit request, you MUST call updateModelicaDocument. Prefer patches.
2. Do not include line numbers in patch text.
3. Do NOT set newContent to an empty string. Omit newContent unless you intend a full replacement.
4. If uncertain, ask 1–2 clarification questions.
5. If compilation is failing, prefer calling autoFixModelicaCompilationCycle.
`

      return ctx.createSubtasksResult([
        createChatCompletionTask({
          prompts: [contextPrompt],
          allowedTools: [
            'updateModelicaDocument',
            'getModelicaCompilerStatus',
            'autoFixModelicaCompilationCycle',
          ],
        }),
      ])
    },
  }),

  createTool({
    name: 'getModelicaCompilerStatus',
    description:
      'Return the latest compile / ABI status and recent relevant logs so the agent can decide next edits.',
    parameters: {
      type: 'object',
      properties: {
        includeSources: {
          type: 'boolean',
          description: 'If true, include model and template sources with line numbers.',
        },
      },
      additionalProperties: false,
    } as const satisfies JSONSchema7,
    function: async ({ includeSources }, ctx) => {
      if (compileNow) {
        try {
          await compileNow()
        } catch (e) {
          console.warn('getModelicaCompilerStatus: compileNow failed', e)
        }
      }
      const logs = modelicaLog.value ?? []
      const status = extractCompileStatus(logs)
      const compileState =
        status.state === 'success'
          ? 'success'
          : status.state === 'error'
            ? 'error'
            : jsSource.value?.trim()
              ? 'success'
              : 'unknown'

      const payload: Record<string, unknown> = {
        compileState,
        lastSuccess: status.lastSuccess ?? null,
        lastFailure: status.lastFailure ?? null,
        recentCompileLogs: status.recentCompileLogs,
        generatedJsPreview: String(jsSource.value || '').slice(0, 400),
        prettyDaePreview: String(daePrettyOutput.value || '').slice(0, 400),
      }

      if (includeSources) {
        payload.modelicaSourceWithLines = formatContentWithLineNumbers(modelicaSource.value || '')
        payload.templateSourceWithLines = formatContentWithLineNumbers(templateSource.value || '')
      }

      return ctx.createSubtasksResult([
        {
          role: 'system',
          content: {
            type: 'message',
            data: serializeObject(payload, MODELICA_AGENT_SERIALIZE_OPTIONS),
          },
        },
      ])
    },
  }),

  createTool({
    name: 'autoFixModelicaCompilationCycle',
    description:
      'Autonomous compile-fix loop: inspect latest compile errors, patch documents, and re-check until success.',
    parameters: {
      type: 'object',
      properties: {
        currentRound: {
          type: 'number',
          description: 'Current repair iteration, starting at 1.',
        },
        maxRounds: {
          type: 'number',
          description: 'Maximum repair iterations before stopping.',
        },
        showAll: {
          type: 'boolean',
          description: 'If true, include full modelica/template/ui/solver content in the prompt.',
        },
      },
      additionalProperties: false,
    } as const satisfies JSONSchema7,
    function: async ({ currentRound, maxRounds, showAll }, ctx) => {
      if (compileNow) {
        try {
          await compileNow()
        } catch (e) {
          console.warn('autoFixModelicaCompilationCycle: compileNow failed', e)
        }
      }
      const round = Number(currentRound ?? 1)
      const max = Number(maxRounds ?? 4)
      const logs = modelicaLog.value ?? []
      const status = extractCompileStatus(logs)
      const hasRenderableOutput = String(jsSource.value || '').trim().length > 0
      const compileState =
        status.state === 'success'
          ? 'success'
          : status.state === 'error'
            ? 'error'
            : hasRenderableOutput
              ? 'success'
              : 'error'

      if (compileState === 'success') {
        return ctx.createSubtasksResult([
          {
            role: 'system',
            content: {
              type: 'message',
              data: `Compile-fix cycle finished: compilation is healthy (round ${round}/${max}).`,
            },
          },
        ])
      }

      if (round > max) {
        return ctx.createSubtasksResult([
          {
            role: 'system',
            content: {
              type: 'message',
              data: `Compile-fix cycle stopped after ${max} rounds without success. Last failure: ${status.lastFailure?.message ?? 'unknown'}`,
            },
          },
        ])
      }

      const includeAll = showAll ?? showAllInPrompt.value ?? true
      const modelicaWithLines = formatContentWithLineNumbers(modelicaSource.value || '')
      const templateWithLines = formatContentWithLineNumbers(templateSource.value || '')
      const uiTemplateWithLines = formatContentWithLineNumbers(uiTemplateSource.value || '')
      const solverWithLines = formatContentWithLineNumbers(solverSource.value || '')
      const sourcesSection = includeAll
        ? `## Modelica Source\n\`\`\`\n${modelicaWithLines}\n\`\`\`\n\n## Template Source\n\`\`\`\n${templateWithLines}\n\`\`\`\n\n## UI Template Source\n\`\`\`\n${uiTemplateWithLines}\n\`\`\`\n\n## Solver Source\n\`\`\`\n${solverWithLines}\n\`\`\``
        : `## Modelica Source\n\`\`\`\n${modelicaWithLines}\n\`\`\`\n\n## Template/UI/Solver\nHidden because showAll is false.`

      const cyclePrompt = `
You are in an autonomous Modelica compile-repair cycle.
Current round: ${round}/${max}

${sourcesSection}

## Last compile failure
\`\`\`json
${serializeObject(status.lastFailure ?? null, MODELICA_AGENT_SERIALIZE_OPTIONS)}
\`\`\`

## Recent compile logs
\`\`\`json
${serializeObject(status.recentCompileLogs, MODELICA_AGENT_SERIALIZE_OPTIONS)}
\`\`\`

## Generated JS preview
\`\`\`
${String(jsSource.value || '').slice(0, 600)}
\`\`\`

Required workflow:
1. Apply exactly one focused fix using updateModelicaDocument.
2. Do not ask the user any question in this loop.
3. If there is nothing to edit, return a short "no_change" message.

Constraints:
- Prefer minimal edits and line patches.
- Do not replace entire files unless necessary.
- Prefer fixing Modelica first when error points to source semantics.
- Prefer fixing template/solver when error is JS/render/runtime.
`

      return ctx.createSubtasksResult([
        [
          createChatCompletionTask({
            prompts: [cyclePrompt],
            allowedTools: ['updateModelicaDocument'],
          }),
          toolCall({
            name: 'autoFixModelicaCompilationCycle',
            arguments: {
              currentRound: round + 1,
              maxRounds: max,
              showAll: includeAll,
            },
          }),
        ],
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
    function: async (
      {
        updates,
        description,
      }: {
        updates: ModelicaDocumentUpdate[]
        description?: string
      },
      ctx,
    ) => {
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
        return ctx.createSubtasksResult([
          createChatCompletionTask({
            prompts: [
              'You called updateModelicaDocument but did not provide any patches or newContent. Provide edits or do not call the tool.',
            ],
            allowedTools: ['updateModelicaDocument'],
          }),
        ])
      }

      // Merge updates by filePath to enforce stable application.
      // Safety: ignore empty-string newContent to prevent accidental wiping.
      const mergedUpdates = updates.reduce<
        Partial<Record<ModelicaFilePath, ModelicaDocumentUpdate>>
      >((acc, update) => {
        const key = update.filePath
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
            ...(hasIncomingNewContent ? { newContent: incomingNewContent } : {}),
            patches: incomingPatches,
          }
        }
        return acc
      }, {})

      const beforeModelica = modelicaSource.value
      const beforeTemplate = templateSource.value
      const beforeUiTemplate = uiTemplateSource.value
      const beforeSolver = solverSource.value
      const changesLog: string[] = []

      for (const filePath of Object.keys(mergedUpdates) as ModelicaFilePath[]) {
        const update = mergedUpdates[filePath]
        if (!update) continue

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
          updatedContent = applyLinePatches(updatedContent, update.patches)
          changesLog.push(`Patched ${filePath} (${update.patches.length} ops)`)
        }

        if (filePath === 'modelica') modelicaSource.value = updatedContent
        if (filePath === 'template') templateSource.value = updatedContent
        if (filePath === 'uiTemplate') uiTemplateSource.value = updatedContent
        if (filePath === 'solver') solverSource.value = updatedContent
      }

      createNewVersion(`AI update: ${description || changesLog.join(', ')}`)

      let compileSummary = 'Compilation step not executed.'
      if (compileNow) {
        try {
          const compileResult = await compileNow()
          compileSummary = compileResult.ok
            ? `Compilation ok${compileResult.message ? `: ${compileResult.message}` : ''}`
            : `Compilation failed${compileResult.message ? `: ${compileResult.message}` : ''}`
        } catch (e) {
          compileSummary = `Compilation threw: ${e instanceof Error ? e.message : String(e)}`
        }
      }

      return ctx.createSubtasksResult([
        {
          role: 'system',
          content: {
            type: 'message',
            data: `Updates applied:\n${changesLog.join('\n')}\n\n${compileSummary}`,
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
