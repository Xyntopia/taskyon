<!-- DocumentEditorPage.vue -->
<template>
  <q-page class="row">
    <!-- Document Editor Card -->
    <q-card class="col q-ma-md" style="min-width: 200px">
      <q-card-section>
        <div class="text-h6">Document Editor</div>
        <div class="text-subtitle2">
          Version: {{ currentVersionIndex + 1 }} / {{ documentVersions.length }}
        </div>
      </q-card-section>

      <q-card-section>
        <!-- Version Controls -->
        <div class="row q-mb-md items-center q-gutter-sm">
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
          <q-space />
          <q-btn
            flat
            dense
            :icon="matAdd"
            color="secondary"
            title="Create New Version"
            @click="createNewVersion"
          />
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
                <q-item-section>Copy Content</q-item-section>
              </q-item>
              <q-item v-close-popup clickable @click="copyAsMarkdown">
                <q-item-section>Copy as Markdown</q-item-section>
              </q-item>
            </q-list>
          </q-btn-dropdown>
        </div>

        <!-- Code Editor -->
        <div class="q-mb-md">
          <CodeEditor
            v-model="currentContent"
            :height="400"
            language="markdown"
            @update:model-value="onContentChange"
          />
        </div>

        <!-- Action Buttons -->
        <div class="row q-mt-md items-center q-gutter-sm">
          <q-btn
            label="Save Version"
            color="primary"
            :disable="!hasUnsavedChanges"
            @click="saveCurrentVersion"
          />
          <q-btn
            flat
            label="Reset to Saved"
            color="secondary"
            :disable="!hasUnsavedChanges"
            @click="resetToSaved"
          />
          <q-btn flat label="Load Sample" color="accent" @click="loadSampleDocument" />
        </div>
      </q-card-section>

      <!-- Version History -->
      <q-card-section v-if="documentVersions.length > 1">
        <div class="text-h6 q-mb-sm">Version History</div>
        <q-list dense>
          <q-item
            v-for="(version, index) in documentVersions"
            :key="index"
            :class="{ 'bg-blue-1': index === currentVersionIndex }"
            clickable
            @click="switchToVersion(index)"
          >
            <q-item-section>
              <q-item-label>Version {{ index + 1 }}</q-item-label>
              <q-item-label caption>{{ formatDate(version.timestamp) }}</q-item-label>
              <q-item-label caption lines="1">{{
                getVersionPreview(version.content)
              }}</q-item-label>
            </q-item-section>
            <q-item-section side>
              <q-btn
                flat
                dense
                round
                :icon="matDelete"
                size="sm"
                color="negative"
                :disable="documentVersions.length === 1"
                @click.stop="deleteVersion(index)"
              />
            </q-item-section>
          </q-item>
        </q-list>
      </q-card-section>
    </q-card>

    <!-- Taskyon iframe -->
    <div class="col" style="min-height: 0; min-width: 200px">
      <iframe
        id="taskyon"
        title="Taskyon agent"
        frameborder="0"
        :src="`${taskyonUrl}?iframe=true`"
        style="width: 100%; height: 99%"
      ></iframe>
    </div>
  </q-page>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue'
import { copyToClipboard, Notify } from 'quasar'
import {
  matNavigateBefore,
  matNavigateNext,
  matAdd,
  matContentCopy,
  matArrowDropDown,
  matDelete,
} from '@quasar/extras/material-icons'
import CodeEditor from 'src/components/CodeEditor.vue'

// Taskyon imports
import type { partialTyConfiguration } from 'src/modules/taskyon/apiTypes'
import type { JSONSchema7 } from 'json-schema'
import { createTool, makeTaskResult, toolCall } from '@taskyon/taskyon'
import { initializeTaskyon } from '../../../packages/tyclient/src'

// Types
interface DocumentVersion {
  content: string
  timestamp: Date
  description?: string
}

interface PatchOperation {
  type: 'replace' | 'insert' | 'delete'
  start: number
  end?: number
  text?: string
}

// State
const documentVersions = ref<DocumentVersion[]>([
  {
    content: '# Welcome to Document Editor\n\nStart editing your document here...',
    timestamp: new Date(),
    description: 'Initial version',
  },
])
const currentVersionIndex = ref(0)
const currentContent = ref('')
const hasUnsavedChanges = ref(false)
const taskyonUrl = window.location.origin

// Computed
const currentVersion = computed(() => documentVersions.value[currentVersionIndex.value])

// Copy functions
function copyContent() {
  copyToClipboard(currentContent.value)
    .then(() => Notify.create({ message: 'Content copied', color: 'primary' }))
    .catch(() => Notify.create({ message: 'Copy failed', color: 'negative' }))
}

function copyAsMarkdown() {
  copyToClipboard(`\`\`\`markdown\n${currentContent.value}\n\`\`\``)
    .then(() => Notify.create({ message: 'Copied as Markdown', color: 'primary' }))
    .catch(() => Notify.create({ message: 'Copy failed', color: 'negative' }))
}

// Version management
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

function resetToSaved() {
  const current = currentVersion.value
  if (current) {
    currentContent.value = current.content
  }
  hasUnsavedChanges.value = false
  Notify.create({ message: 'Reset to saved version', color: 'info' })
}

function deleteVersion(index: number) {
  if (documentVersions.value.length === 1) return

  documentVersions.value.splice(index, 1)

  // Adjust current index if needed
  if (currentVersionIndex.value >= documentVersions.value.length) {
    currentVersionIndex.value = documentVersions.value.length - 1
  } else if (index <= currentVersionIndex.value && currentVersionIndex.value > 0) {
    currentVersionIndex.value--
  }

  const version = documentVersions.value[currentVersionIndex.value]
  if (version) {
    currentContent.value = version.content
  }
  hasUnsavedChanges.value = false
  Notify.create({ message: 'Version deleted', color: 'warning' })
}

function loadSampleDocument() {
  const sampleContent = `# Sample Document

## Introduction
This is a sample document to demonstrate the document editor capabilities.

## Features
- **Version Control**: Keep track of multiple versions of your document
- **Patch-based Editing**: Efficient updates using text patches
- **AI Integration**: Get help from Taskyon AI assistant
- **Syntax Highlighting**: Support for various programming languages

## Code Example
\`\`\`javascript
function hello(name) {
  console.log(\`Hello, \${name}!\`);
}

hello('World');
\`\`\`

## Task List
- [x] Create basic editor
- [x] Add version control
- [ ] Implement advanced features
- [ ] Add more language support

---

*Document created on ${new Date().toLocaleDateString()}*
`
  currentContent.value = sampleContent
  hasUnsavedChanges.value = true
  Notify.create({ message: 'Sample document loaded', color: 'info' })
}

// Utility functions
function formatDate(date: Date): string {
  return date.toLocaleString()
}

function getVersionPreview(content: string): string {
  const firstLine = content.split('\n')[0]
  if (!firstLine) return 'Empty document'
  return firstLine.length > 50 ? firstLine.substring(0, 47) + '...' : firstLine
}

// Apply patch to text
function applyPatch(text: string, patches: PatchOperation[]): string {
  let result = text
  // Apply patches in reverse order to maintain indices
  patches.sort((a, b) => (b.start || 0) - (a.start || 0))

  for (const patch of patches) {
    switch (patch.type) {
      case 'replace':
        result =
          result.substring(0, patch.start) +
          (patch.text || '') +
          result.substring(patch.end || patch.start)
        break
      case 'insert':
        result =
          result.substring(0, patch.start) + (patch.text || '') + result.substring(patch.start)
        break
      case 'delete':
        result = result.substring(0, patch.start) + result.substring(patch.end || patch.start)
        break
    }
  }
  return result
}

// Initialize on mount
onMounted(() => {
  const current = currentVersion.value
  if (current) {
    currentContent.value = current.content
  }

  // Taskyon tools configuration
  const tools = [
    createTool({
      name: 'updateDocument',
      description: 'Update the document content using text patches for efficient editing',
      parameters: {
        type: 'object',
        properties: {
          patches: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                type: { type: 'string', enum: ['replace', 'insert', 'delete'] },
                start: { type: 'number', description: 'Start position in the text' },
                end: { type: 'number', description: 'End position (for replace/delete)' },
                text: { type: 'string', description: 'Text to insert/replace with' },
              },
              required: ['type', 'start'],
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
        let updatedContent: string

        if (newContent) {
          // Full content replacement
          updatedContent = newContent
        } else if (patches) {
          // Apply patches
          updatedContent = applyPatch(currentContent.value, patches)
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

    createTool({
      name: 'getDocumentInfo',
      description: 'Get information about the current document and editor state',
      parameters: {
        type: 'object',
        properties: {},
        additionalProperties: false,
      } as const satisfies JSONSchema7,
      function: () => {
        const current = currentVersion.value
        if (!current) {
          return makeTaskResult({
            role: 'system',
            content: {
              type: 'message',
              data: 'Error: No current version available',
            },
          })
        }

        const info = {
          currentVersion: currentVersionIndex.value + 1,
          totalVersions: documentVersions.value.length,
          contentLength: currentContent.value.length,
          hasUnsavedChanges: hasUnsavedChanges.value,
          lastModified: current.timestamp,
          contentPreview: currentContent.value.substring(0, 500),
        }

        return makeTaskResult([
          {
            role: 'system',
            content: {
              type: 'message',
              data: `## Current Document Info\n\n**Version:** ${info.currentVersion} of ${info.totalVersions}\n**Content Length:** ${info.contentLength} characters\n**Has Unsaved Changes:** ${info.hasUnsavedChanges}\n**Last Modified:** ${info.lastModified.toLocaleString()}\n\n**Content Preview:**\n\`\`\`\n${info.contentPreview}${info.contentLength > 500 ? '...' : ''}\n\`\`\``,
            },
          },
        ])
      },
    }),
  ]

  const gettingStarted = {
    label: 'Example: Ask AI to help with document structure',
    md: `
<!--taskyon
role: user
name: document help

-->

Can you help me create a better structure for this document? Please review the current content and suggest improvements.

---

<!--taskyon
role: assistant
name: document help
content:
  type: structured
  data: >
    Do we have to use a tool?: true

    describe your thoughts: The user wants help with document structure. I should first get information about the current document to understand what we're working with, then provide suggestions and potentially update the document with a better structure.

    use tool: true

    which tool: getDocumentInfo

    command:
      name: getDocumentInfo
      arguments: {}

-->

---

<!--taskyon
role: function
name: document help
content:
  type: functioncall
  data:
    name: getDocumentInfo
    arguments: {}

-->

---

<!--taskyon
role: assistant
name: document structure analysis

-->

Based on the current document, I can help improve its structure! Let me analyze what you have and suggest some enhancements with better organization, formatting, and content flow.
        `,
  }

  const configuration: partialTyConfiguration = {
    llmSettings: {
      enableOpenAiTools: false,
      enableToolChooser: true,
      entryNode: toolCall({ name: 'getDocumentInfo', arguments: {} }),
    },
    appConfiguration: {
      guiMode: 'default',
      showLogo: false,
      chatSuggestions: [gettingStarted],
      welcomeMsg:
        'Hi! I can help you edit and improve your documents. I can see the current content and make efficient patch-based updates.',
    },
  }

  void initializeTaskyon(tools, configuration /*true*/)
})

// Watch for version changes to update content
watch(currentVersionIndex, (newIndex) => {
  if (!hasUnsavedChanges.value) {
    const version = documentVersions.value[newIndex]
    if (version) {
      currentContent.value = version.content
    }
  }
})
</script>
