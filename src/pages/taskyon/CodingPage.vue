<!-- eslint-disable no-useless-escape -->
<!-- DocumentEditorPage.vue -->
<template>
  <q-page class="row">
    <SplitTaskyonView :configuration="configuration" :tools="tools" name="codingpage" persist>
      <!-- Document Editor Card -->
      <div dense class="col column">
        <!-- Version Controls -->
        <div class="row">
          <div style="font-size: x-small" class="q-pl-xs">
            Version:<br />{{ currentVersionIndex + 1 }} / {{ documentVersions.length }}
          </div>
          <q-btn
            flat
            dense
            :icon="matNavigateBefore"
            title="Previous Version"
            :disable="currentVersionIndex === 0"
            @click="goToPreviousVersion"
          />
          <q-btn
            flat
            dense
            :icon="matNavigateNext"
            title="Next Version"
            :disable="currentVersionIndex === documentVersions.length - 1"
            @click="goToNextVersion"
          />
          <q-btn
            flat
            dense
            :icon="mdiTextBoxPlus"
            color="secondary"
            title="Create New Version"
            @click="createNewVersion"
          />
          <q-space />
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
            title="Copy"
            @click="copyContent"
          />
          <q-btn
            flat
            dense
            :icon="mdiNewBox"
            color="secondary"
            title="Reset Document"
            @click="reset"
          />
          <!--
        <q-btn-dropdown
          color="primary"
          size="sm"
          :icon="matContentCopy"
          label="Copy"
          flat
          dense
          :dropdown-icon="matArrowDropDown"
        >
          <q-list>
            <q-item v-close-popup clickable @click="copyContent">
              <q-item-section></q-item-section>
            </q-item>
            <q-item v-close-popup clickable @click="copyAsMarkdown">
              <q-item-section>Copy as Markdown</q-item-section>
            </q-item>
          </q-list>
        </q-btn-dropdown>
      -->
        </div>

        <!-- Code Editor / Preview -->
        <q-card flat class="col" style="max-width: 100%">
          <div v-if="!showPreview" class="col">
            <CodeEditor
              v-model="currentContent"
              class="col"
              placeholder="Write here..."
              language="javascript"
              style="max-height: 87vh"
              @update:model-value="onContentChange"
            />
          </div>
          <div v-else class="col column">
            <iframe
              class="col"
              style="border: 1px solid #ccc; width: 100%; min-height: 87vh"
              :srcdoc="iframeContent"
            ></iframe>
            <div
              class="q-mt-xs text-caption"
              :class="isCodeValid ? 'text-positive' : 'text-negative'"
            >
              <span v-if="isCodeValid">Preview loaded without runtime errors.</span>
              <span v-else>Preview error: {{ validationError }}</span>
            </div>
          </div>
        </q-card>
      </div>
    </SplitTaskyonView>
  </q-page>
</template>

<script setup lang="ts">
import {
  matCode,
  matContentCopy,
  matNavigateBefore,
  matNavigateNext,
  matVisibility,
} from '@quasar/extras/material-icons'
import { mdiNewBox, mdiTextBoxPlus } from '@quasar/extras/mdi-v6'
import {
  createChatCompletionTask,
  createTool,
  makeTaskResult,
  removeKeys,
  toolCall,
} from '@taskyon/taskyon'
import { watchThrottled } from '@vueuse/core'
import type { JSONSchema7 } from 'json-schema'
import { copyToClipboard, Notify } from 'quasar'
import CodeEditor from 'src/components/CodeEditor.vue'
import SplitTaskyonView from 'src/components/SplitTaskyonView.vue'
import type { partialTyConfiguration } from 'src/modules/taskyon/apiTypes'
import { useAppStateStore } from 'src/stores/appState'
import { useTaskyonStore } from 'src/stores/taskyonState'
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'

const state = useAppStateStore()
const tystate = useTaskyonStore()

// Types
interface DocumentVersion {
  content: string
  timestamp: Date
  description?: string
}

interface LinePatchOperation {
  type: 'replace' | 'insert' | 'delete'
  lineStart: number // 1-based line number
  lineEnd?: number | undefined // 1-based line number (inclusive) for replace/delete
  text?: string | undefined // New text for replace/insert
}

interface LineInfo {
  lineNumber: number
  content: string
  startPos: number
  endPos: number
}

// Taskyon tools configuration
// Taskyon tools configuration
const tools = [
  // Entry node tool - provides context and decides next action
  createTool({
    name: 'documentAssistant',
    description:
      'Main document assistant that provides context and decides on next actions for document editing',
    parameters: {
      type: 'object',
      properties: {},
      additionalProperties: false,
    } as const satisfies JSONSchema7,
    function: () => {
      // Gather document context information
      const lineInfo = getLineInfo(currentContent.value)
      const documentInfo = {
        currentVersion: currentVersionIndex.value + 1,
        totalVersions: documentVersions.value.length,
        contentLength: currentContent.value.length,
        totalLines: lineInfo.length,
        hasUnsavedChanges: hasUnsavedChanges.value,
        lastModified: currentVersion.value?.timestamp || 'never',
        contentPreview: formatContentWithLineNumbers(currentContent.value, maxPreviewLines),
        versions: documentVersions.value.map((v, i) => ({
          index: i + 1,
          timestamp: v.timestamp,
          preview: getVersionPreview(v.content),
          description: v.description,
        })),
      }

      // Create context prompt for the AI
      const contextPrompt = `
You are the Taskyon Document Assistant helping users edit and manage their documents.

This application is used **almost exclusively to edit code/files**. Your primary job is to **apply concrete edits** to the current document using the \`updateDocument\` tool.

## Current Document State
**Version:** ${documentInfo.currentVersion} of ${documentInfo.totalVersions}
**Content Length:** ${documentInfo.contentLength} characters
**Total Lines:** ${documentInfo.totalLines}
**Has Unsaved Changes:** ${documentInfo.hasUnsavedChanges}
**Last Modified:** ${documentInfo.lastModified.toLocaleString()}

## Available Versions
${documentInfo.versions
  .map((v) => `- Version ${v.index}: ${v.preview} (${v.timestamp.toLocaleString()})`)
  .join('\n')}

## Current Content (with line numbers)
\`\`\`
${documentInfo.contentPreview}
\`\`\`

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
- \`lineEnd\`: (optional) The end line for replace/delete operations (inclusive)
- \`text\`: The new text for replace/insert operations (can be multi-line)

## CRITICAL BEHAVIOR RULES

1. **Always apply edits via \`updateDocument\`**
   - Whenever the user wants to **create, modify, refactor, reformat, or delete** any part of the document, you **MUST** call \`updateDocument\`.
   - Do **NOT** just answer with "here is the updated code" or "change line X to Y" without also calling \`updateDocument\`.
   - If the document is empty and the user asks to **create a new file**, use \`updateDocument\` with \`newContent\`.

2. **When to NOT use \`updateDocument\`**
   - Only skip \`updateDocument\` if the user is clearly asking **purely conceptual questions** (e.g., "Explain what this function does", "What does this error mean?", "How does async/await work in JS?").
   - If there is any reasonable interpretation that the user wants the document changed, treat it as an **editing request** and use \`updateDocument\`.

3. **Clarification before editing**
   - If you are **uncertain** what the user wants changed, ask **clarifying questions** first.
   - Once you understand the requested change, call \`updateDocument\` to apply it.
   - You may ask 1–2 short clarification questions before calling the tool, but do not stay in Q&A mode forever when an edit is clearly requested.

4. **How to respond**
   - For edit requests:
     - Call \`updateDocument\` with appropriate \`patches\` or \`newContent\`.
     - In the tool result description, clearly explain what you changed (e.g., which lines, what behavior changed).
   - For non-edit, conceptual questions:
     - Answer normally **without** calling \`updateDocument\`.

Your goal is to **keep the document in sync with the user's intent**. When in doubt, prefer **actually editing the document** via \`updateDocument\` instead of just suggesting changes.
`

      return makeTaskResult([
        createChatCompletionTask({
          prompts: [contextPrompt],
          goal: 'ChooseTool',
          allowedTools: ['updateDocument'],
        }),
      ])
    },
  }),

  // Document update tool - handles actual document modifications
  createTool({
    name: 'updateDocument',
    description:
      'Update the document content using line-based patches for efficient editing or full content replacement',
    parameters: {
      type: 'object',
      properties: {
        patches: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              type: {
                type: 'string',
                enum: ['replace', 'insert', 'delete'],
                description: 'Type of patch operation',
              },
              lineStart: {
                type: 'number',
                description: 'Start line number (1-based)',
              },
              lineEnd: {
                type: 'number',
                description: 'End line number (1-based, inclusive) for replace/delete operations',
              },
              text: {
                type: 'string',
                description: 'Text to insert/replace with (can be multi-line)',
              },
            },
            required: ['type', 'lineStart'],
          },
        },
        newContent: {
          type: 'string',
          description: 'Full new content (alternative to patches)',
        },
        description: {
          type: 'string',
          description: 'Description of the changes made',
        },
      },
      additionalProperties: false,
    } as const satisfies JSONSchema7,
    function: ({ patches, newContent, description }) => {
      createNewVersion()
      saveCurrentVersion()
      let updatedContent: string

      createNewVersion()
      if (newContent) {
        // Full content replacement
        updatedContent = newContent
      } else if (patches) {
        // Apply line-based patches
        const linePatches: LinePatchOperation[] = patches.map((patch) => ({
          type: patch.type,
          lineStart: patch.lineStart,
          lineEnd: patch.lineEnd,
          text: patch.text,
        }))

        updatedContent = applyLinePatches(currentContent.value, linePatches)
      } else {
        return makeTaskResult({
          role: 'system',
          content: {
            type: 'return',
            data: 'Error: Either patches or newContent must be provided',
          },
        })
      }

      // Update the editor content
      currentContent.value = updatedContent
      hasUnsavedChanges.value = true
      saveCurrentVersion()

      const changeDescription = description || 'Document updated by AI'

      return makeTaskResult({
        role: 'system',
        content: {
          type: 'message',
          data: `Document updated successfully!\n\n**Changes:** ${changeDescription}\n\n**Content preview:**\n\`\`\`\n${updatedContent.substring(0, 200)}${updatedContent.length > 200 ? '...' : ''}\n\`\`\``,
        },
      })
    },
  }),
]

const configuration = computed<partialTyConfiguration | null>(() => {
  if (state.authToken == null) return null
  return {
    llmSettings: {
      ...removeKeys(state.llmSettings, ['entryNode']),
      //enableOpenAiTools: false,
      enableToolChooser: true,
      entryNode: toolCall({ name: 'documentAssistant', arguments: {} }),
    },
    appConfiguration: {
      ...removeKeys(state.appConfiguration, ['chatSuggestions']),
      guiMode: 'minChat',
      expertMode: true,
      showLogo: false,
      chatSuggestions: [],
      welcomeMsg:
        'Hi! I can help you edit documents. I can see the current content with line numbers and make precise line-based edits.',
    },
    signatureOrKey: tystate.currentKeyString ?? undefined,
  }
})

// State
const documentVersions = ref<DocumentVersion[]>([])
const currentVersionIndex = ref(0)
const currentContent = ref('')
const hasUnsavedChanges = ref(false)

const showPreview = ref(false)
const isCodeValid = ref(true)
const validationError = ref('')

const iframeContent = computed(() => {
  const userCode = currentContent.value || ''
  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8" />
<title>Preview</title>
<style>
  html, body { margin: 0; padding: 0; height: 100%; }
  body { box-sizing: border-box; padding: 8px; }
</style>
  <script>
  window.onerror = function(message, source, lineno, colno, error) {
    parent.postMessage({ type: 'iframe-error', message, source, lineno, colno }, '*');
  };
  window.addEventListener('DOMContentLoaded', function() {
    parent.postMessage({ type: 'iframe-ready' }, '*');
  });
<\u002Fscript>
</head>
<body>
${userCode}
</body>
</html>`
})

// make sure we persist current version for page reloads
const storeKey = 'codeEditorText'
const initialText = state.store[storeKey] as string
if (initialText) currentContent.value = initialText
watchThrottled(currentContent, (text) => {
  console.log('store text!!')
  state.store[storeKey] = text
  // Reset validation state on content change; iframe will report any new errors
  isCodeValid.value = true
  validationError.value = ''
})

// Computed
const currentVersion = computed(() => documentVersions.value[currentVersionIndex.value])

// Copy functions
function copyContent() {
  copyToClipboard(currentContent.value)
    .then(() => Notify.create({ message: 'Content copied', color: 'primary' }))
    .catch(() => Notify.create({ message: 'Copy failed', color: 'negative' }))
}

function reset() {
  documentVersions.value = []
  currentVersionIndex.value = 0
  currentContent.value = ''
  hasUnsavedChanges.value = false
}
function togglePreview() {
  showPreview.value = !showPreview.value
}

function handleIframeMessage(event: MessageEvent) {
  if (!event.data || typeof event.data !== 'object') return
  const { type, message } = event.data as { type?: string; message?: string }
  if (type === 'iframe-error') {
    isCodeValid.value = false
    validationError.value = message || 'Unknown error'
  } else if (type === 'iframe-ready') {
    isCodeValid.value = true
    validationError.value = ''
  }
}

// Version management functions (unchanged)
function onContentChange() {
  const current = currentVersion.value
  if (current) {
    hasUnsavedChanges.value = currentContent.value !== current.content
  }
}

function saveCurrentVersion() {
  if (!hasUnsavedChanges.value) return

  const current = currentVersion.value
  if (!current) return

  documentVersions.value[currentVersionIndex.value] = {
    ...current,
    content: currentContent.value,
    timestamp: new Date(),
  }
  hasUnsavedChanges.value = false
  Notify.create({ message: 'Version saved', color: 'positive' })
}

function createNewVersion() {
  const newVersion: DocumentVersion = {
    content: currentContent.value,
    timestamp: new Date(),
    description: `Version ${documentVersions.value.length + 1}`,
  }
  documentVersions.value.push(newVersion)
  currentVersionIndex.value = documentVersions.value.length - 1
  hasUnsavedChanges.value = false
  Notify.create({ message: 'New version created', color: 'positive' })
}

function switchToVersion(index: number) {
  if (hasUnsavedChanges.value) {
    // Ask user if they want to save changes
    if (confirm('You have unsaved changes. Do you want to save them before switching versions?')) {
      saveCurrentVersion()
    }
  }
  currentVersionIndex.value = index
  const version = documentVersions.value[index]
  if (version) {
    currentContent.value = version.content
  }
  hasUnsavedChanges.value = false
}

function goToPreviousVersion() {
  if (currentVersionIndex.value > 0) {
    switchToVersion(currentVersionIndex.value - 1)
  }
}

function goToNextVersion() {
  if (currentVersionIndex.value < documentVersions.value.length - 1) {
    switchToVersion(currentVersionIndex.value + 1)
  }
}

function getVersionPreview(content: string): string {
  const firstLine = content.split('\n')[0]
  if (!firstLine) return 'Empty document'
  return firstLine.length > 50 ? firstLine.substring(0, 47) + '...' : firstLine
}

// Get line information with character positions
function getLineInfo(content: string): LineInfo[] {
  const lines = content.split('\n')
  const lineInfo: LineInfo[] = []
  let currentPos = 0

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!
    lineInfo.push({
      lineNumber: i + 1,
      content: line,
      startPos: currentPos,
      endPos: currentPos + line.length,
    })
    currentPos += line.length + 1 // +1 for the newline character
  }

  return lineInfo
}

// Format content with line numbers
function formatContentWithLineNumbers(content: string, maxLines?: number): string {
  const lines = content.split('\n')
  const totalLines = lines.length
  const displayLines = maxLines ? lines.slice(0, maxLines) : lines

  const formatted = displayLines
    .map((line, index) => {
      const maxLineDigits = Math.max(1, Math.floor(Math.log10(lines.length)) + 1)
      const lineNum = (index + 1).toString().padStart(maxLineDigits, ' ')
      return `${lineNum}: ${line}`
    })
    .join('\n')

  if (maxLines && totalLines > maxLines) {
    return formatted + `\n... (${totalLines - maxLines} more lines)`
  }

  return formatted
}

// Apply line-based patches to text
function applyLinePatches(text: string, patches: LinePatchOperation[]): string {
  const lines = text.split('\n')

  // Sort patches by line number in reverse order to maintain indices
  patches.sort((a, b) => (b.lineStart || 0) - (a.lineStart || 0))

  for (const patch of patches) {
    const lineIndex = patch.lineStart - 1 // Convert to 0-based index

    switch (patch.type) {
      case 'replace':
        if (patch.lineEnd !== undefined) {
          const endIndex = patch.lineEnd - 1
          const newLines = patch.text ? patch.text.split('\n') : []
          lines.splice(lineIndex, endIndex - lineIndex + 1, ...newLines)
        } else {
          // Replace single line
          lines[lineIndex] = patch.text || ''
        }
        break
      case 'insert': {
        const insertLines = patch.text ? patch.text.split('\n') : ['']
        lines.splice(lineIndex, 0, ...insertLines)
        break
      }
      case 'delete':
        if (patch.lineEnd !== undefined) {
          const endIndex = patch.lineEnd - 1
          lines.splice(lineIndex, endIndex - lineIndex + 1)
        } else {
          // Delete single line
          lines.splice(lineIndex, 1)
        }
        break
    }
  }

  return lines.join('\n')
}

const maxPreviewLines = 1000

// Initialize on mount
onMounted(() => {
  window.addEventListener('message', handleIframeMessage)
  const current = currentVersion.value
  if (current) {
    currentContent.value = current.content
  }
})

onBeforeUnmount(() => {
  window.removeEventListener('message', handleIframeMessage)
})
</script>
