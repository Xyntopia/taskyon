<!-- eslint-disable no-useless-escape -->
<!-- CodingPage.vue -->
<template>
  <q-page class="row">
    <SplitTaskyonView
      :configuration="configuration"
      :tools="tools"
      :name="tystate.usingFreeTaskyonKey ? 'codingpage_free' : 'codingpage'"
      profile-name="coding_page"
      :binding-key="state.bindingKey"
      missing-binding-key-policy="noBindingKey"
      persist
    >
      <!-- Document Editor Card -->
      <div dense class="col column no-wrap fit">
        <!-- Version & File Controls -->
        <div class="row items-center q-pa-xs q-gutter-x-xs">
          <!-- File Selector -->
          <q-select
            v-model="activeFileName"
            :options="fileList"
            label="Current File"
            dense
            outlined
            options-dense
            class="col-grow"
            style="min-width: 150px"
            :disable="fileList.length === 0"
          >
            <template #prepend>
              <q-icon :name="matDescription" />
            </template>
          </q-select>

          <FileDropzone
            class="editor-drop-zone"
            disable-dropzone-border
            accept="*"
            @add-files="handleAddFiles"
          >
            <q-btn dense flat round title="Upload File">
              <q-icon :name="matUpload" />
            </q-btn>
          </FileDropzone>

          <q-btn
            flat
            dense
            round
            :icon="matContentPaste"
            title="Paste as new file"
            @click="pasteAsNewFile"
          />

          <q-btn
            flat
            dense
            round
            :icon="matAdd"
            title="Create File"
            @click="openCreateFileDialog"
          />

          <q-btn
            flat
            dense
            round
            :icon="mdiRenameBox"
            :disable="!activeFileName"
            title="Rename Current File"
            @click="openRenameFileDialog"
          />

          <q-btn
            flat
            dense
            round
            :icon="matDelete"
            :disable="!canDeleteFile || !activeFileName"
            title="Delete Current File"
            @click="openDeleteFileDialog"
          />

          <q-separator vertical class="q-mx-sm" />

          <!-- Version Info -->
          <div style="font-size: x-small" class="text-center">
            Ver:<br />{{ currentVersionIndex + 1 }} / {{ documentVersions.length }}
          </div>

          <!-- Version Navigation -->
          <q-btn
            flat
            dense
            round
            :icon="matNavigateBefore"
            title="Previous Version"
            :disable="currentVersionIndex === 0"
            @click="goToPreviousVersion"
          />
          <q-btn
            flat
            dense
            round
            :icon="matNavigateNext"
            title="Next Version"
            :disable="currentVersionIndex === documentVersions.length - 1"
            @click="goToNextVersion"
          />
          <q-btn
            flat
            dense
            round
            :icon="mdiTextBoxPlus"
            color="secondary"
            title="Create New Version Snapshot"
            @click="handleCreateNewVersionClick"
          />

          <q-space />

          <q-toggle
            v-model="showAllFilesInPrompt"
            dense
            size="sm"
            color="secondary"
            label="AI sees all files"
          />

          <q-btn
            flat
            dense
            :icon="showPreview ? matCode : matVisibility"
            color="secondary"
            :label="showPreview ? 'Editor' : 'Preview'"
            title="Toggle editor/preview"
            @click="togglePreview"
          />
          <q-btn
            flat
            dense
            :icon="matContentCopy"
            color="secondary"
            title="Copy Current File"
            @click="copyContent"
          />
          <q-btn
            flat
            dense
            :icon="mdiNewBox"
            color="secondary"
            title="Reset Project"
            @click="reset"
          />
        </div>

        <!-- Code Editor / Preview -->
        <q-card flat class="col column no-wrap">
          <div v-if="!showPreview" class="col column no-wrap fit">
            <div v-if="activeFileName" class="col scroll">
              <CodeEditor
                :key="activeFileName"
                v-model="activeFileContent"
                :language="getLanguage(activeFileName)"
                placeholder="Write here..."
                @update:model-value="onContentChange"
              />
            </div>

            <!-- Empty state when there are no files yet -->
            <div
              v-else-if="fileList.length === 0"
              class="col q-pa-lg column items-center justify-center text-grey-8"
            >
              <div class="text-subtitle2 q-mb-sm">Welcome to the project editor</div>
              <div class="text-body2 q-mb-sm">You don't have any files yet. You can:</div>
              <ul class="text-body2 q-mb-md">
                <li>Paste text using the "Paste as new file" button above</li>
                <li>Upload existing files using the upload button</li>
                <li>Create a new empty file with the "+" (Create File) button</li>
              </ul>
              <div class="text-caption text-grey-7">
                The AI agent can also automatically create new files for you as needed.
              </div>
            </div>

            <!-- When there are files but none is selected -->
            <div v-else class="col flex flex-center text-grey">No file selected</div>
          </div>
          <div v-else class="col column relative-position no-wrap" style="min-height: 0">
            <div class="col scroll" style="min-height: 0">
              <iframe
                style="border: none; width: 100%; height: 100%"
                sandbox="allow-scripts allow-modals allow-popups allow-forms"
                :srcdoc="previewContent"
              ></iframe>
            </div>
            <div
              class="absolute-bottom q-pa-xs text-center text-caption bg-white"
              style="border-top: 1px solid #ddd"
            >
              Previewing: {{ activeFileName }}
            </div>
          </div>
        </q-card>
      </div>
    </SplitTaskyonView>

    <q-dialog v-model="isCreateFileDialogOpen">
      <q-card style="min-width: 300px">
        <q-card-section>
          <div class="text-h6">Create New File</div>
        </q-card-section>
        <q-card-section>
          <q-input
            v-model="newFileName"
            label="File name (e.g. index.html, main.js)"
            autofocus
            dense
            @keyup.enter="confirmCreateFile"
          />
        </q-card-section>
        <q-card-actions align="right">
          <q-btn v-close-popup flat label="Cancel" />
          <q-btn
            flat
            label="Create"
            color="primary"
            :disable="!newFileName"
            @click="confirmCreateFile"
          />
        </q-card-actions>
      </q-card>
    </q-dialog>

    <q-dialog v-model="isRenameFileDialogOpen">
      <q-card style="min-width: 300px">
        <q-card-section>
          <div class="text-h6">Rename File</div>
        </q-card-section>
        <q-card-section>
          <q-input
            v-model="renameFileName"
            label="New file name"
            autofocus
            dense
            @keyup.enter="confirmRenameFile"
          />
        </q-card-section>
        <q-card-actions align="right">
          <q-btn v-close-popup flat label="Cancel" />
          <q-btn
            flat
            label="Rename"
            color="primary"
            :disable="!renameFileName || renameFileName === activeFileName"
            @click="confirmRenameFile"
          />
        </q-card-actions>
      </q-card>
    </q-dialog>

    <q-dialog v-model="isDeleteFileDialogOpen">
      <q-card style="min-width: 300px">
        <q-card-section>
          <div class="text-h6">Delete File</div>
        </q-card-section>
        <q-card-section>
          <div>
            Are you sure you want to delete <strong>{{ activeFileName }}</strong
            >?
          </div>
        </q-card-section>
        <q-card-actions align="right">
          <q-btn v-close-popup flat label="Cancel" />
          <q-btn flat label="Delete" color="negative" @click="confirmDeleteFile" />
        </q-card-actions>
      </q-card>
    </q-dialog>
  </q-page>
</template>

<script setup lang="ts">
import {
  matAdd,
  matCode,
  matContentCopy,
  matContentPaste,
  matDelete,
  matDescription,
  matNavigateBefore,
  matNavigateNext,
  matUpload,
  matVisibility,
} from '@quasar/extras/material-icons'
import { mdiNewBox, mdiRenameBox, mdiTextBoxPlus } from '@quasar/extras/mdi-v6'
import { createChatCompletionTask, createTool, makeTaskResult } from '@taskyon/tyclient'
import { watchThrottled } from '@vueuse/core'
import type { JSONSchema7 } from 'json-schema'
import { Notify } from 'quasar'
import { applyLinePatches } from '@taskyon/taskyon/tools/filePatching'
import { copyToClipboard } from '../../../packages/shared/modules/utils'
import CodeEditor from '@taskyon/shared/components/CodeEditor.vue'
import FileDropzone from '@taskyon/shared/components/FileDropzone.vue'
import SplitTaskyonView from '@taskyon/shared/components/SplitTaskyonView.vue'
import type { partialTyConfiguration } from 'src/modules/taskyon/apiTypes'
import { useAppStateStore } from 'src/stores/appState'
import { useTaskyonStore } from 'src/stores/taskyonState'
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'

const state = useAppStateStore()
const tystate = useTaskyonStore()
const isInVscode = state.isInVscode

const VSCODE_MESSAGE_SOURCE = 'taskyon-vscode'

const isCreateFileDialogOpen = ref(false)
const isRenameFileDialogOpen = ref(false)
const isDeleteFileDialogOpen = ref(false)
const newFileName = ref('')
const renameFileName = ref('')

// --- Types ---

type FilePath = string
type FileContent = string
type FilesMap = Record<FilePath, FileContent>

interface ProjectVersion {
  files: FilesMap
  timestamp: Date
  description?: string
}

// --- State ---

const files = ref<FilesMap>({})
const activeFileName = ref<string>('')
const documentVersions = ref<ProjectVersion[]>([])
const currentVersionIndex = ref(0)
const hasUnsavedChanges = ref(false)
const showPreview = ref(false)
const showAllFilesInPrompt = ref(true)

// --- Computed ---

const fileList = computed(() => Object.keys(files.value))
const canDeleteFile = computed(() => Object.keys(files.value).length > 1)

// Proxy for the CodeEditor v-model
const activeFileContent = computed({
  get: () => files.value[activeFileName.value] || '',
  set: (val) => {
    if (activeFileName.value) {
      files.value = {
        ...files.value,
        [activeFileName.value]: val,
      }
    }
  },
})

const currentVersion = computed(() => documentVersions.value[currentVersionIndex.value])

// Basic preview strategy:
// If HTML, show it. If JS/CSS, wrap it slightly or just show text?
// For now, we stick to the iframe logic for the *active* file if it looks like HTML,
// or wrap it if it looks like JS.
const previewContent = computed(() => {
  const fileName = activeFileName.value || ''
  const content = activeFileContent.value
  const isHtml = fileName.endsWith('.html') || fileName.endsWith('.htm')

  if (isHtml) return content

  // Default wrapper for non-html content (treating as script or text)
  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8" />
<style>body{font-family:monospace;white-space:pre-wrap;}</style>
</head>
<body>
${content}
</body>
</html>`
})

// --- Persistence ---

const storeKey = 'multiFileProjectData'

// We store a simplified snapshot: { files: ..., versionCount: ... }
// Recovering exact version history might be heavy, so we might just store last state or simplified history.
// For this "minimal" implementation, let's try to persist `files` and maybe the current content.
// Actually, let's persist everything like before but adapted.
interface PersistedState {
  version: number
  files: FilesMap
  // We can add version history later if needed, but let's keep it light for localStorage
}

// Restore
const savedData = !isInVscode ? (state.store[storeKey] as PersistedState | undefined) : undefined
if (savedData && savedData.files) {
  files.value = savedData.files
  // Restore basic version hook if we want, or just start fresh with content
  // initializing a base version
  documentVersions.value = [
    {
      files: { ...savedData.files },
      timestamp: new Date(),
      description: 'Restored session',
    },
  ]
  currentVersionIndex.value = 0
  if (Object.keys(files.value).length > 0) {
    activeFileName.value = Object.keys(files.value)[0]!
  }
} else if (!isInVscode) {
  // Start with an empty project and an initial empty version snapshot
  createNewVersion('Initial empty project')
}
if (isInVscode && documentVersions.value.length === 0) {
  documentVersions.value = [
    {
      files: {},
      timestamp: new Date(),
      description: 'Waiting for VS Code',
    },
  ]
  currentVersionIndex.value = 0
}

// Persist
if (!isInVscode) {
  watchThrottled(
    files,
    (newFiles) => {
      state.store[storeKey] = {
        version: 1,
        files: newFiles,
      }
    },
    { deep: true, throttle: 1000 },
  )
}

// --- Tools Configuration ---

const tools = [
  createTool({
    name: 'documentAssistant',
    description: 'Main assistant that inspects the project files and decides on next actions.',
    parameters: {
      type: 'object',
      properties: {
        webSearch: {
          type: 'boolean',
          description: 'Whether web search is enabled for this session',
        },
        showAllFiles: {
          type: 'boolean',
          description:
            'If true, include the full contents (truncated) of all files in the prompt, not just the active one.',
        },
      },
      additionalProperties: false,
    } as const satisfies JSONSchema7,
    function: (opts) => {
      const showAllFiles = opts.showAllFiles ?? showAllFilesInPrompt.value ?? false

      // 1. Context Assembly
      const fileNames = Object.keys(files.value)
      const currentFile = activeFileName.value
      const maxLinesPerFile = 3000

      const currentFileContent = files.value[currentFile] || ''

      const filesPreview = fileNames
        .map((name) => {
          // TODO: make sure, taskyon sees all open files, if it needs to! (use this as a function argument?)
          const content = files.value[name] || ''
          const lineCount = content.split('\n').length
          const isCurrent = name === currentFile ? ' (Currently Open)' : ''
          return `- **${name}**${isCurrent}: ${lineCount} lines`
        })
        .join('\n')

      let filesContentsSection = ''
      if (showAllFiles) {
        const filesDetails = fileNames
          .map((name) => {
            const content = files.value[name] || ''
            const formatted = formatContentWithLineNumbers(content, maxLinesPerFile)
            return (
              `### File: ${name}${name === currentFile ? ' (Currently Open)' : ''}` +
              '\n```' +
              '\n' +
              formatted +
              '\n```'
            )
          })
          .join('\n\n')

        filesContentsSection = `## Contents of All Files (truncated)` + `\n${filesDetails}`
      } else {
        const activeContentWithLines = formatContentWithLineNumbers(
          currentFileContent,
          maxLinesPerFile,
        )

        filesContentsSection =
          `## Content of Active File (${currentFile})` +
          `\n\`\`\`\n${activeContentWithLines}\n\`\`\``
      }

      const contextPrompt = `
You are the Taskyon Coding Assistant managing a multi-file project.

## Project State
**Total Files:** ${fileNames.length}
**Current Active File:** ${currentFile}
**Files in Project:**
${filesPreview}

${filesContentsSection}

## Capabilities
- You can read and edit **any** file in the project, not just the active one.
- You can apply edits to **multiple files** in a single \`updateDocument\` call.
- Use \`updateDocument\` to modify existing files.

## Available Tool: \`updateDocument\`
You have access to the \`updateDocument\` tool which can:
- Apply line-based patches to the document:
  - **Replace**: Replace one or more lines
  - **Insert**: Insert new lines at a specific position
  - **Delete**: Delete one or more lines
- **Replace the entire document content** using \`newContent\`
- Add human-readable **descriptions** of the changes made

## Line-Based Editing
- Lines are numbered starting from 1
- \`lineStart\`: The line number where the operation begins (1-based)
- \`lineEnd\`: (optional) The end line for replace/delete operations (the patch will be applied including this line! That means if you want to replace line 10 only, lineStart and lineEnd should both be 10)
- \`text\`: The new text for replace/insert operations (can be multi-line)

## CRITICAL BEHAVIOR RULES

1. **Always apply edits via \`updateDocument\`**
   - Whenever the user wants to **create, modify, refactor, reformat, or delete** any part of the document, you **MUST** call \`updateDocument\`.
   - Do **NOT** just answer with "here is the updated code" or "change line X to Y" without also calling \`updateDocument\`.
   - If the document is empty and the user asks to **create a new file**, use \`updateDocument\` with \`newContent\`.
   - Do **NOT** explain to the user what changes should be made, but apply them using the tool if its possible!

2. **When to NOT use \`updateDocument\`**
   - Only skip \`updateDocument\` if the user is clearly asking **purely conceptual questions** (e.g., "Explain what this function does", "What does this error mean?", "How does async/await work in JS?").
   - If there is any reasonable interpretation that the user wants the document changed, treat it as an **editing request** and use \`updateDocument\`.

3. **Clarification before editing**
   - If you are **uncertain** what the user wants changed, ask **clarifying questions** first.
   - Once you understand the requested change, call \`updateDocument\` to apply it.
   - You may ask 1–2 short clarification questions before calling the tool, but do not stay in Q&A mode forever when an edit is clearly requested.

4. **How to respond**
    - For edit requests:
      - Always prefer patching instead of replacing the entire document.
      - Do not include the "NNNN:" line number prefixes in patch \`text\`; line numbers belong only in \`lineStart\` and \`lineEnd\`.
      - If you can edit an existing document, prefer that instead of creating a new one.
      - Call \`updateDocument\` with appropriate \`patches\` or \`newContent\`.
     - In the tool result description, clearly explain what you changed (e.g., which lines, what behavior changed).
   - For non-edit, conceptual questions:
     - Answer normally **without** calling \`updateDocument\`.

Your goal is to **keep the document in sync with the user's intent**. When in doubt, prefer **actually editing the document** via \`updateDocument\` instead of just suggesting changes.
      If you do not want to make any changes to the document, don't call \`updateDocument\` at all.
`
      return makeTaskResult([
        ...(opts.webSearch
          ? [createChatCompletionTask({ websearch: { enabled: true, max_results: 5 } })]
          : []),
        createChatCompletionTask({
          prompts: [contextPrompt],
          allowedTools: ['updateDocument'],
        }),
      ])
    },
  }),

  createTool({
    name: 'updateDocument',
    description: 'Update one or more files in the project.',
    parameters: {
      type: 'object',
      properties: {
        updates: {
          type: 'array',
          description:
            'An array of updates to apply. Each update specifies a file and the changes to make. You can patch and update multiple files at once',
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
                    text: {
                      type: 'string',
                      description:
                        'The new text for replace/insert operations (can be multi-line). Make sure to *not* include the lines numbers here in the text...!',
                    },
                  },
                  required: ['type', 'lineStart'],
                },
                description:
                  'Line-based patch operations to apply to the file. Lines are 1-based indexed. Make sure to not have overlaps in the patches.',
              },
              newContent: {
                type: 'string',
                description:
                  'Full new content for the file. Only do this, if really necessary, otherwise use patches.',
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
      // count total number of edits, because often the AI still uses this tool, but doesn't apply any
      // edits if it simply wants to respond...
      const totalEdits = updates.reduce((acc, update) => {
        const patchCount = update.patches ? update.patches.length : 0
        const hasNewContent = update.newContent !== undefined && update.newContent !== null
        return acc + patchCount + (hasNewContent ? 1 : 0)
      }, 0)
      if (totalEdits === 0) {
        Notify.create({
          type: 'warning',
          message: 'No edits provided in updateDocument call',
        })
        return makeTaskResult([
          createChatCompletionTask({
            prompts: [
              "It seems you called updateDocument but did not provide any edits or new content. Please make sure to include the changes you want to apply. Or don't call it at all",
            ],
            allowedTools: ['updateDocument'],
          }),
        ])
      }

      // We compute the updated file map first, and only commit if everything validates.
      const currentFilesSnapshot = { ...files.value } // Shallow copy of map
      const changesLog: string[] = []

      // Merge objects with same filepaths in order to make sure we apply patches in the correct order
      const mergedUpdates = updates.reduce(
        (acc, update) => {
          const existing = acc[update.filePath]
          if (!existing) {
            acc[update.filePath] = { ...update, patches: [...(update.patches || [])] }
            return acc
          }

          if (update.newContent !== undefined && update.newContent !== null) {
            existing.newContent = update.newContent
          }

          existing.patches = [...(existing.patches || []), ...(update.patches || [])]
          return acc
        },
        {} as Record<string, (typeof updates)[0]>,
      )

      try {
        for (const update of Object.values(mergedUpdates)) {
          const { filePath, newContent, patches } = update
          const originalContent = currentFilesSnapshot[filePath]
          const hasNewContent = newContent !== undefined && newContent !== null && newContent !== ''
          const hasPatches = (patches?.length ?? 0) > 0

          if (hasNewContent && hasPatches) {
            Notify.create({
              type: 'warning',
              message: `updateDocument: Both newContent and patches provided for ${filePath}. Applying patches after newContent.`,
            })
          }

          // If the file does not exist yet and `newContent` is provided, we treat this as a request to create a new file.
          // If only patches are provided for a non-existent file, we skip it because we cannot reliably apply line-based patches.
          if (originalContent === undefined) {
            if (hasNewContent && newContent !== '') {
              let createdContent = newContent
              if (hasPatches)
                createdContent = applyLinePatches(createdContent, patches || [], { validate: true })
              currentFilesSnapshot[filePath] = createdContent
              changesLog.push(`Created file ${filePath}`)
            } else if (hasNewContent && newContent === '') {
              Notify.create({
                type: 'warning',
                message: `updateDocument: newContent was empty for non-existent file ${filePath}. Skipping.`,
              })
              changesLog.push(`Skipped ${filePath}: Empty newContent for non-existent file.`)
            } else if (hasPatches) {
              changesLog.push(
                `Skipped ${filePath}: File not found (cannot apply patches to non-existent file).`,
              )
            }
            continue
          }

          let updatedContent = originalContent
          if (hasNewContent) {
            updatedContent = newContent
            changesLog.push(`Replaced content of ${filePath}`)
          }

          if (hasPatches) {
            updatedContent = applyLinePatches(updatedContent, patches || [], { validate: true })
            changesLog.push(`Patched ${filePath} (${patches!.length} ops)`)
          }

          currentFilesSnapshot[filePath] = updatedContent
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        Notify.create({
          type: 'negative',
          message: `updateDocument failed: ${msg}`,
        })
        return makeTaskResult([
          createChatCompletionTask({
            prompts: [
              `updateDocument failed while applying patches: ${msg}\nPlease resend the updateDocument call with corrected, non-overlapping, in-range patches.`,
            ],
            allowedTools: ['updateDocument'],
          }),
        ])
      }

      // Commit changes
      files.value = currentFilesSnapshot
      if (!isInVscode) {
        createNewVersion(`Auto-update: ${description || changesLog.join(', ')}`)
      }

      const returnMsgs = [
        {
          role: 'system' as const,
          content: {
            type: 'message' as const,
            data: `Updates applied:\n${changesLog.join('\n')}`,
          },
        },
      ]

      if (description) {
        returnMsgs.push({
          role: 'system' as const,
          content: {
            type: 'message' as const,
            data: description,
          },
        })
      }

      return makeTaskResult(returnMsgs)
    },
  }),
]

const configuration = computed<partialTyConfiguration | null>(() => {
  const taskyonKey = tystate.getTaskyonKeyString()
  if (taskyonKey == null) return null
  return {
    llmSettings: {
      entryFunction: 'documentAssistant',
    },
    toolchainConfig: {
      documentAssistant: {
        showAllFiles: false,
      },
    },
    appConfiguration: {
      guiMode: 'minChat',
      expertMode: true,
      showLogo: false,
      chatSuggestions: [],
      welcomeMsg:
        'I can help edit files in this coding workspace. Upload or create files here to get started.',
    },
    signatureOrKey: taskyonKey,
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

  const nextFiles = {
    ...files.value,
    [payload.path]: payload.content ?? '',
  }
  files.value = nextFiles
  activeFileName.value = payload.path

  if (documentVersions.value.length === 0) {
    documentVersions.value = [
      {
        files: { ...nextFiles },
        timestamp: new Date(),
        description: 'Synced from VS Code',
      },
    ]
    currentVersionIndex.value = 0
  }
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

// --- Helper Functions ---

function getLanguage(fileName: string) {
  if (fileName.endsWith('.js') || fileName.endsWith('.ts')) return 'javascript'
  if (fileName.endsWith('.html')) return 'html'
  if (fileName.endsWith('.css')) return 'css'
  if (fileName.endsWith('.json')) return 'json'
  if (fileName.endsWith('.vue')) return 'html' // simplistic
  return 'javascript' // default
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

// --- Actions (UI) ---

function copyContent() {
  void copyToClipboard(activeFileContent.value).then((ok) => {
    if (ok) {
      Notify.create({ message: 'Copied!', color: 'positive' })
    } else {
      Notify.create({ message: 'Copy failed', color: 'negative' })
    }
  })
}

async function pasteAsNewFile() {
  if (!('clipboard' in navigator) || !navigator.clipboard?.readText) {
    Notify.create({
      message: 'Clipboard paste is not supported in this browser/context.',
      color: 'negative',
    })
    return
  }

  let text: string
  try {
    text = await navigator.clipboard.readText()
  } catch {
    Notify.create({
      message: 'Could not read from clipboard. Please grant permission and try again.',
      color: 'negative',
    })
    return
  }

  if (!text) {
    Notify.create({
      message: 'Clipboard is empty or does not contain text.',
      color: 'warning',
    })
    return
  }

  // Auto-generate a simple file name like "pasted content 1", "pasted content 2", ...
  let index = 1
  let name = `pasted content ${index}`
  while (files.value[name] !== undefined) {
    index += 1
    name = `pasted content ${index}`
  }

  files.value = {
    ...files.value,
    [name]: text,
  }
  activeFileName.value = name
  createNewVersion(`Created file ${name} from clipboard`)
}

function reset() {
  files.value = {}
  activeFileName.value = ''
  documentVersions.value = []
  createNewVersion('Reset')
}

async function handleAddFiles(addedFiles: File[]) {
  if (!addedFiles || addedFiles.length === 0) return

  const nextFiles: FilesMap = { ...files.value }
  const addedNames: string[] = []

  for (const file of addedFiles) {
    // Simple behavior: add/overwrite using file name as key
    nextFiles[file.name] = await file.text()
    addedNames.push(file.name)
  }

  files.value = nextFiles

  // If there was no active file before, focus the first added one
  if (!activeFileName.value && addedNames.length > 0) {
    activeFileName.value = addedNames[0]!
  }

  if (addedNames.length > 0) {
    createNewVersion(`Added files: ${addedNames.join(', ')}`)
  }
}

function openCreateFileDialog() {
  newFileName.value = ''
  isCreateFileDialogOpen.value = true
}

function confirmCreateFile() {
  const name = newFileName.value.trim()
  if (!name) return
  if (files.value[name] !== undefined) {
    Notify.create({
      message: `File "${name}" already exists`,
      color: 'negative',
    })
    return
  }

  files.value = {
    ...files.value,
    [name]: '',
  }
  activeFileName.value = name
  isCreateFileDialogOpen.value = false
  createNewVersion(`Created file ${name}`)
}

function openRenameFileDialog() {
  if (!activeFileName.value) return
  renameFileName.value = activeFileName.value
  isRenameFileDialogOpen.value = true
}

function confirmRenameFile() {
  const oldName = activeFileName.value
  const nextName = renameFileName.value.trim()
  if (!oldName || !nextName || nextName === oldName) {
    isRenameFileDialogOpen.value = false
    return
  }
  if (files.value[nextName] !== undefined) {
    Notify.create({
      message: `File "${nextName}" already exists`,
      color: 'negative',
    })
    return
  }

  const updated: FilesMap = {}
  for (const [key, value] of Object.entries(files.value)) {
    updated[key === oldName ? nextName : key] = value
  }
  files.value = updated
  activeFileName.value = nextName
  isRenameFileDialogOpen.value = false
  createNewVersion(`Renamed file ${oldName} -> ${nextName}`)
}

function openDeleteFileDialog() {
  if (!activeFileName.value || !canDeleteFile.value) return
  isDeleteFileDialogOpen.value = true
}

function confirmDeleteFile() {
  const name = activeFileName.value
  if (!name) {
    isDeleteFileDialogOpen.value = false
    return
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { [name]: _removed, ...rest } = files.value
  files.value = rest
  const remaining = Object.keys(rest)
  activeFileName.value = remaining[0] ?? ''
  isDeleteFileDialogOpen.value = false
  createNewVersion(`Deleted file ${name}`)
}

function togglePreview() {
  showPreview.value = !showPreview.value
}

// Versioning Logic
// We now snapshot the whole file map
function createNewVersion(desc?: string) {
  const snapshot: ProjectVersion = {
    files: { ...files.value },
    timestamp: new Date(),
    description: desc || `Version ${documentVersions.value.length + 1}`,
  }
  documentVersions.value = [...documentVersions.value, snapshot]
  currentVersionIndex.value = documentVersions.value.length - 1
  hasUnsavedChanges.value = false
  Notify.create({ message: 'Version snapshot saved', color: 'positive', timeout: 1000 })
}

function handleCreateNewVersionClick() {
  createNewVersion()
}

function onContentChange() {
  // Check if current files differ from current version snapshot
  // This is a bit expensive for deep comparison every keystroke, so we throttle or simplify.
  // For now, let's just assume if user types, we have "unsaved changes" relative to the last snapshot.
  const currentSnap = currentVersion.value
  if (!currentSnap) return

  // Simple check: active file changed?
  const activeFile = activeFileName.value
  if (files.value[activeFile] !== currentSnap.files[activeFile]) {
    hasUnsavedChanges.value = true
  }
}

function goToPreviousVersion() {
  if (currentVersionIndex.value > 0) {
    jumpToVersion(currentVersionIndex.value - 1)
  }
}

function goToNextVersion() {
  if (currentVersionIndex.value < documentVersions.value.length - 1) {
    jumpToVersion(currentVersionIndex.value + 1)
  }
}

function jumpToVersion(idx: number) {
  currentVersionIndex.value = idx
  const target = documentVersions.value[idx]
  if (target) {
    // Restore files
    files.value = { ...target.files }
  }
}
</script>
