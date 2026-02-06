<template>
  <q-page class="row">
    <SplitTaskyonView :configuration="configuration" :tools="tools" name="vscode" persist>
      <div class="col column no-wrap fit">
        <div class="row items-center q-pa-xs q-gutter-x-sm">
          <q-icon :name="matDescription" />
          <div class="text-subtitle2">Active VS Code File</div>
          <div class="text-body2 text-weight-medium">
            {{ activeFileName || 'No file selected' }}
          </div>
          <q-space />
          <q-badge v-if="isInVscode" color="positive" label="VS Code Connected" />
          <q-badge v-else color="warning" label="VS Code Not Detected" />
        </div>

        <q-card flat class="col column no-wrap">
          <div v-if="activeFileName" class="col scroll">
            <CodeEditor
              :key="activeFileName"
              v-model="activeFileContent"
              :language="getLanguage(activeFileName)"
              :read-only="true"
            />
          </div>
          <div v-else class="col flex flex-center text-grey">
            Open a file in VS Code to show it here.
          </div>
        </q-card>
      </div>
    </SplitTaskyonView>
  </q-page>
</template>

<script setup lang="ts">
import { matDescription } from '@quasar/extras/material-icons'
import {
  createChatCompletionTask,
  createTool,
  makeTaskResult,
  removeKeys,
  toolCall,
} from '@taskyon/taskyon'
import type { JSONSchema7 } from 'json-schema'
import CodeEditor from 'src/components/CodeEditor.vue'
import SplitTaskyonView from 'src/components/SplitTaskyonView.vue'
import type { partialTyConfiguration } from 'src/modules/taskyon/apiTypes'
import { useAppStateStore } from 'src/stores/appState'
import { useTaskyonStore } from 'src/stores/taskyonState'
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'

const state = useAppStateStore()
const tystate = useTaskyonStore()
const isInVscode = state.isInVscode

const VSCODE_MESSAGE_SOURCE = 'taskyon-vscode'

type FilePath = string
type FileContent = string
type FilesMap = Record<FilePath, FileContent>

interface LinePatchOperation {
  type: 'replace' | 'insert' | 'delete'
  lineStart: number
  lineEnd?: number
  text?: string
}

const files = ref<FilesMap>({})
const activeFileName = ref<string>('')

const activeFileContent = computed({
  get: () => files.value[activeFileName.value] || '',
  set: () => {
    // Read-only view; updates come from VS Code events.
  },
})

const tools = [
  createTool({
    name: 'vscodeAssistant',
    description: 'Assistant for editing VS Code files via Taskyon tools.',
    parameters: {
      type: 'object',
      properties: {
        webSearch: {
          type: 'boolean',
          description: 'Whether web search is enabled for this session',
        },
      },
      additionalProperties: false,
    } as const satisfies JSONSchema7,
    function: (opts) => {
      const currentFile = activeFileName.value
      const currentFileContent = files.value[currentFile] || ''
      const maxLines = 400
      const contentWithLines = formatContentWithLineNumbers(currentFileContent, maxLines)

      const contextPrompt = `
You are the Taskyon VS Code assistant.

## Active File
**Path:** ${currentFile || '(none)'}
**Lines:** ${currentFileContent.split('\n').length}

## Content (truncated)
\`\`\`
${contentWithLines}
\`\`\`

## Capabilities
- You can read and edit files in the user's VS Code workspace.
- Use \`updateDocument\` to apply changes. Prefer line-based patches.

## Line-Based Editing
- Lines are numbered starting from 1
- \`lineStart\`: The line number where the operation begins (1-based)
- \`lineEnd\`: (optional) The end line for replace/delete operations (inclusive)
- \`text\`: The new text for replace/insert operations (can be multi-line)

## CRITICAL RULES
1. When a user wants changes, always call \`updateDocument\`.
2. If you are unsure about intent, ask for clarification first.
3. Prefer patches over replacing full content unless necessary.
`

      return makeTaskResult([
        ...(opts.webSearch ? [createChatCompletionTask({ goal: 'WebSearch' })] : []),
        createChatCompletionTask({
          prompts: [contextPrompt],
          goal: 'ChooseTool',
          allowedTools: ['updateDocument'],
        }),
      ])
    },
  }),
  createTool({
    name: 'updateDocument',
    description: 'Update one or more files in the VS Code workspace.',
    parameters: {
      type: 'object',
      properties: {
        updates: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              filePath: {
                type: 'string',
                description: 'The path/name of the file to update',
              },
              patches: {
                type: 'array',
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
                description:
                  'Full new content for the file. Only do this if necessary; prefer patches.',
              },
            },
            required: ['filePath'],
          },
        },
        description: { type: 'string', description: 'Summary of changes' },
      },
      required: ['updates'],
    } as const satisfies JSONSchema7,
    function: ({ updates, description }) => {
      if (isInVscode) {
        window.parent?.postMessage(
          {
            source: VSCODE_MESSAGE_SOURCE,
            type: 'vscodeApplyEdits',
            payload: { updates, description },
          },
          '*',
        )
      }

      const nextFiles = { ...files.value }
      const changesLog: string[] = []

      for (const update of updates) {
        const { filePath, newContent, patches } = update
        const originalContent = nextFiles[filePath]

        if (originalContent === undefined) {
          if (newContent !== undefined && newContent !== null && newContent !== '') {
            nextFiles[filePath] = newContent
            changesLog.push(`Created file ${filePath}`)
          } else {
            changesLog.push(`Skipped ${filePath}: File not found.`)
          }
          continue
        }

        let updatedContent = originalContent
        if (newContent !== undefined && newContent !== null && newContent !== '') {
          updatedContent = newContent
          changesLog.push(`Replaced content of ${filePath}`)
        } else if (patches) {
          updatedContent = applyLinePatches(originalContent, patches)
          changesLog.push(`Patched ${filePath} (${patches.length} ops)`)
        }

        nextFiles[filePath] = updatedContent
      }

      files.value = nextFiles

      return makeTaskResult({
        role: 'system',
        content: {
          type: 'message',
          data: `Updates applied:\n${changesLog.join('\n')}`,
        },
      })
    },
  }),
]

const configuration = computed<partialTyConfiguration | null>(() => {
  if (tystate.currentKeyString == null) return null
  return {
    llmSettings: {
      ...removeKeys(state.llmSettings, ['entryNode']),
      enableToolChooser: true,
      entryNode: toolCall({ name: 'vscodeAssistant', arguments: {} }),
    },
    appConfiguration: {
      ...removeKeys(state.appConfiguration, ['chatSuggestions']),
      guiMode: 'minChat',
      expertMode: true,
      showLogo: false,
      chatSuggestions: [],
      welcomeMsg: 'Ask me to edit your active VS Code file.',
    },
    signatureOrKey: tystate.currentKeyString ?? undefined,
  }
})

type VscodeActiveFilePayload = {
  uri: string
  path: string
  content: string
  languageId?: string
  version?: number
}

const handleVscodeActiveFile = (payload: VscodeActiveFilePayload) => {
  if (!payload?.path) return
  files.value = {
    ...files.value,
    [payload.path]: payload.content ?? '',
  }
  activeFileName.value = payload.path
}

const onVscodeMessage = (event: MessageEvent) => {
  const data = event.data as { source?: string; type?: string; payload?: VscodeActiveFilePayload }
  if (!data || data.source !== VSCODE_MESSAGE_SOURCE) return
  if (data.type === 'vscodeActiveFile' && data.payload) {
    handleVscodeActiveFile(data.payload)
  }
}

onMounted(() => {
  if (!isInVscode) return
  window.addEventListener('message', onVscodeMessage)
})

onBeforeUnmount(() => {
  if (!isInVscode) return
  window.removeEventListener('message', onVscodeMessage)
})

function getLanguage(fileName: string) {
  if (fileName.endsWith('.js') || fileName.endsWith('.ts')) return 'javascript'
  if (fileName.endsWith('.html')) return 'html'
  if (fileName.endsWith('.css')) return 'css'
  if (fileName.endsWith('.json')) return 'json'
  if (fileName.endsWith('.vue')) return 'html'
  return 'javascript'
}

function formatContentWithLineNumbers(content: string, maxLines?: number): string {
  const lines = content.split('\n')
  const totalLines = lines.length
  const displayLines = maxLines ? lines.slice(0, maxLines) : lines

  return (
    displayLines
      .map((line, index) => {
        const lineNum = (index + 1).toString().padStart(4, ' ')
        return `${lineNum}: ${line}`
      })
      .join('\n') +
    (maxLines && totalLines > maxLines ? `\n... (${totalLines - maxLines} more)` : '')
  )
}

function applyLinePatches(text: string, patches: LinePatchOperation[]): string {
  const lines = text.split('\n')
  const sortedPatches = [...patches].sort((a, b) => b.lineStart - a.lineStart)

  for (const patch of sortedPatches) {
    const startIdx = patch.lineStart - 1
    if (startIdx < 0) continue

    if (patch.type === 'insert') {
      const newLines = (patch.text || '').split('\n')
      lines.splice(startIdx, 0, ...newLines)
    } else {
      const endLine = patch.lineEnd ?? patch.lineStart
      const deleteCount = endLine - patch.lineStart + 1
      if (patch.type === 'delete') {
        lines.splice(startIdx, deleteCount)
      } else if (patch.type === 'replace') {
        const newLines = (patch.text || '').split('\n')
        lines.splice(startIdx, deleteCount, ...newLines)
      }
    }
  }
  return lines.join('\n')
}
</script>
