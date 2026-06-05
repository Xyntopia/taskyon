<template>
  <FadeAwayScrollPage padding class="column q-gutter-md">
    <div class="text-h6">Add MCP Tools</div>
    <div class="text-caption">
      Import MCP `tools/list` payloads from hosted MCP endpoints and save selected tools as Taskyon
      tool definitions.
    </div>

    <div class="row q-col-gutter-sm">
      <q-input
        v-model="serverName"
        class="col-12 col-md-4"
        dense
        filled
        label="MCP Server Name (optional)"
      />
      <q-select
        class="col-12 col-md-4"
        dense
        filled
        :options="exampleOptions"
        :model-value="selectedExampleId"
        label="Free MCP Example"
        @update:model-value="selectExample"
      />
      <q-select
        class="col-12 col-md"
        dense
        filled
        :options="mcpToolOptions"
        :model-value="selectedMcpToolName"
        label="Select Parsed MCP Tool"
        @update:model-value="selectMcpTool"
      />
      <q-btn flat dense label="Load Example" @click="loadExample" />
    </div>
    <div v-if="selectedExampleMeta" class="text-caption">
      Source:
      <a :href="selectedExampleMeta.sourceUrl" target="_blank">{{ selectedExampleMeta.label }}</a>
      | Server URL: <code>{{ selectedExampleMeta.serverUrl }}</code>
      <span v-if="selectedExampleMeta.authHint"> | Auth: {{ selectedExampleMeta.authHint }}</span>
    </div>

    <DockView
      v-model:node="initialLayout"
      class="col"
      hide-tab-add
      hide-tab-close
      :tab-icons="{
        payload: mdiCodeJson,
        mapped: mdiFormTextbox,
      }"
    >
      <template #payload>
        <JsonInput
          v-model="mcpPayload"
          class="fit"
          filled
          auto-save
          autogrow="false"
          placeholder='Paste MCP tools payload or full JSON-RPC "tools/list" response'
        />
      </template>
      <template #mapped>
        <JsonInput v-model="toolDraft" class="fit" filled auto-save autogrow="false" />
      </template>
    </DockView>

    <div class="row items-center q-gutter-sm">
      <q-btn
        :disable="!isValidTool || !preliminaryTaskNode"
        :color="isValidTool ? 'positive' : 'negative'"
        :icon="matSave"
        label="Save MCP Tool"
        @click="saveTool"
      />
      <q-btn flat dense label="Open Tool Editor" :to="`/tool/${toolDraft.name || ''}`" />
      <div v-if="!isValidTool" class="text-negative text-caption">
        Tool definition is invalid: {{ toolParser }}
      </div>
    </div>
  </FadeAwayScrollPage>
</template>

<script setup lang="ts">
import { matSave } from '@quasar/extras/material-icons'
import { mdiCodeJson, mdiFormTextbox } from '@quasar/extras/mdi-v6'
import type { DockNode } from '@taskyon/shared/components/DockView.vue'
import DockView from '@taskyon/shared/components/DockView.vue'
import FadeAwayScrollPage from '@taskyon/shared/components/FadeAwayScrollPage.vue'
import JsonInput from '@taskyon/shared/components/varViews/JsonInput.vue'
import type { partialTaskDraft, TaskNode, ToolBase } from '@taskyon/taskyon'
import { createTaskNode, ToolBase as ToolBaseSchema } from '@taskyon/taskyon'
import type { JSONSchema7 } from 'json-schema'
import { asyncComputed } from 'src/modules/vueUtils'
import { useTaskyonStore } from 'src/stores/taskyonState'
import { computed, ref } from 'vue'
import { useRouter } from 'vue-router'
import z from 'zod'

type McpInputTool = {
  name: string
  description?: string
  inputSchema?: unknown
}

type McpExample = {
  id: string
  label: string
  sourceUrl: string
  serverName: string
  serverUrl: string
  authHint?: string
  payload: {
    tools: McpInputTool[]
  }
}

const fallbackSchema: Readonly<JSONSchema7> = {
  type: 'object',
  additionalProperties: true,
}

const mcpExamples: McpExample[] = [
  {
    id: 'deepwiki-read-structure',
    label: 'DeepWiki (no auth): read_wiki_structure',
    sourceUrl: 'https://github.com/CognitionAI/deepwiki',
    serverName: 'deepwiki',
    serverUrl: 'https://mcp.deepwiki.com/mcp',
    authHint: 'No login required',
    payload: {
      tools: [
        {
          name: 'read_wiki_structure',
          description: 'Get documentation topic structure for a public GitHub repository.',
          inputSchema: {
            type: 'object',
            properties: {
              repoName: { type: 'string', description: 'Repository in owner/repo format' },
            },
            required: ['repoName'],
          },
        },
      ],
    },
  },
  {
    id: 'open-weather-current',
    label: 'Open-MCP Weather: get_current_weather',
    sourceUrl: 'https://www.open-mcp.org/servers/open-weather',
    serverName: 'open-weather',
    serverUrl: 'https://mcp.open-mcp.org/api/server/open-weather@latest/mcp',
    authHint: 'No login required',
    payload: {
      tools: [
        {
          name: 'get_current_weather',
          description: 'Get current weather for a location.',
          inputSchema: {
            type: 'object',
            properties: {
              latitude: { type: 'number', description: 'Latitude' },
              longitude: { type: 'number', description: 'Longitude' },
            },
            required: ['latitude', 'longitude'],
          },
        },
      ],
    },
  },
  {
    id: 'petstore-find-by-status',
    label: 'Open-MCP Petstore: findPetsByStatus',
    sourceUrl: 'https://www.open-mcp.org/servers/swagger-petstore',
    serverName: 'swagger-petstore',
    serverUrl: 'https://mcp.open-mcp.org/api/server/swagger-petstore@latest/mcp',
    authHint: 'No login required',
    payload: {
      tools: [
        {
          name: 'findPetsByStatus',
          description: 'Find pets by status in the Swagger Petstore demo API.',
          inputSchema: {
            type: 'object',
            properties: {
              status: {
                type: 'string',
                description: 'Pet status filter',
                enum: ['available', 'pending', 'sold'],
              },
            },
            required: ['status'],
          },
        },
      ],
    },
  },
]

const initialLayout = ref<DockNode>({
  id: 'root',
  type: 'container',
  direction: 'row',
  children: [
    {
      id: 'payload',
      type: 'leaf',
      collapsed: false,
      views: ['payload', 'mapped'],
      activeViewIndex: 0,
      size: 100,
    },
  ],
})

const tystate = useTaskyonStore()
const router = useRouter()

const serverName = ref('')
const mcpPayload = ref<Record<string, unknown>>({})
const selectedExampleId = ref<string>(mcpExamples[0]?.id ?? '')
const selectedMcpToolName = ref<string | undefined>(undefined)
const toolDraft = ref<ToolBase>({
  name: '',
  description: '',
  parameters: fallbackSchema,
})

const JsonObjectSchema = z.record(z.string(), z.unknown())
const McpInputToolSchema = z.object({
  name: z.string(),
  description: z.string().optional(),
  inputSchema: z.unknown().optional(),
})
const McpToolsPayloadSchema = z.union([
  z.array(McpInputToolSchema),
  z.object({ tools: z.array(McpInputToolSchema) }),
  z.object({
    result: z.object({
      tools: z.array(McpInputToolSchema),
    }),
  }),
])

function normalizeToolName(name: string): string {
  return name.replace(/[^a-zA-Z0-9_-]/g, '_')
}

function toJsonSchema(value: unknown): Readonly<JSONSchema7> {
  const parsed = JsonObjectSchema.safeParse(value)
  return parsed.success ? (parsed.data as JSONSchema7) : fallbackSchema
}

function parseToolsFromPayload(payload: unknown): McpInputTool[] {
  const parsed = McpToolsPayloadSchema.safeParse(payload)
  if (!parsed.success) return []
  if (Array.isArray(parsed.data)) return parsed.data
  if ('tools' in parsed.data) return parsed.data.tools
  return parsed.data.result.tools
}

function toTaskyonTool(input: McpInputTool, sourceName?: string): ToolBase {
  const normalizedName = normalizeToolName(input.name)
  const mappedDescription =
    input.description || `Imported MCP tool ${input.name}${sourceName ? ` from ${sourceName}` : ''}`
  return {
    name: normalizedName,
    description: mappedDescription,
    longDescription: sourceName
      ? `Imported from MCP server: ${sourceName}. Original tool name: ${input.name}.`
      : `Imported MCP tool. Original tool name: ${input.name}.`,
    parameters: toJsonSchema(input.inputSchema),
  }
}

const parsedMcpTools = computed(() => parseToolsFromPayload(mcpPayload.value))

const mcpToolOptions = computed(() => parsedMcpTools.value.map((t) => t.name))
const exampleOptions = computed(() => mcpExamples.map((e) => ({ label: e.label, value: e.id })))
const selectedExampleMeta = computed(() =>
  mcpExamples.find((example) => example.id === selectedExampleId.value),
)

function syncToolDraftFromSelection() {
  const selected = parsedMcpTools.value.find((t) => t.name === selectedMcpToolName.value)
  if (!selected) return
  toolDraft.value = toTaskyonTool(selected, serverName.value || undefined)
}

function selectMcpTool(value: string | null) {
  if (!value) return
  selectedMcpToolName.value = value
  syncToolDraftFromSelection()
}

function loadExample() {
  const selected = selectedExampleMeta.value
  if (!selected) return
  serverName.value = selected.serverName
  mcpPayload.value = selected.payload
  const firstTool = selected.payload.tools[0]
  if (!firstTool) return
  selectedMcpToolName.value = firstTool.name
  syncToolDraftFromSelection()
}

function selectExample(value: string | null) {
  if (!value) return
  selectedExampleId.value = value
}

const toolParser = computed(() => {
  try {
    const copy = JSON.parse(JSON.stringify(toolDraft.value))
    const result = ToolBaseSchema.strict().safeParse(copy)
    return result.success ? true : result.error
  } catch (error) {
    return error
  }
})

const isValidTool = computed(() => toolParser.value === true)

const preliminaryTaskNode = asyncComputed<TaskNode | undefined>(async () => {
  try {
    return await createTaskNode({
      role: 'user',
      content: {
        type: 'tooldefinition',
        data: JSON.parse(JSON.stringify(toolDraft.value)),
      },
    })
  } catch {
    return undefined
  }
}, undefined)

async function addNewTask(task: partialTaskDraft) {
  const ty = await tystate.taskyon
  return await ty.addPartialTask2Tree(task)
}

async function saveTool() {
  if (!preliminaryTaskNode.value || !isValidTool.value) return
  const task = await addNewTask(preliminaryTaskNode.value)
  void router.push(`/tool/${task.id}`)
}
</script>
