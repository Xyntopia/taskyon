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
        :options="importedMcpToolOptions"
        :model-value="selectedImportedMcpToolName"
        label="Select Parsed MCP Tool"
        @update:model-value="selectImportedMcpTool"
      />
      <q-btn flat dense label="Load Example" @click="loadExample" />
      <q-btn flat dense label="Fetch MCP Tools" @click="fetchMcpTools" />
    </div>
    <div class="row q-col-gutter-sm">
      <q-input
        v-model="serverUrl"
        class="col-12"
        dense
        filled
        label="MCP Server URL"
        placeholder="https://.../mcp"
      />
    </div>
    <div v-if="selectedExampleMeta" class="text-caption">
      Source:
      <a :href="selectedExampleMeta.sourceUrl" target="_blank">{{ selectedExampleMeta.label }}</a>
      | Server URL: <code>{{ selectedExampleMeta.serverUrl }}</code>
      <span v-if="selectedExampleMeta.authHint"> | Auth: {{ selectedExampleMeta.authHint }}</span>
    </div>
    <div v-if="fetchStatus" class="text-caption">{{ fetchStatus }}</div>

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
import type { DockNode } from '@taskyon/ui/components/DockView.vue'
import DockView from '@taskyon/ui/components/DockView.vue'
import FadeAwayScrollPage from '@taskyon/ui/components/FadeAwayScrollPage.vue'
import JsonInput from '@taskyon/ui/components/varViews/JsonInput.vue'
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
const selectedImportedMcpToolName = ref<string | undefined>(undefined)
const serverUrl = ref('')
const fetchStatus = ref('')
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
type McpToolsPayload = z.infer<typeof McpToolsPayloadSchema>

function normalizeToolName(name: string): string {
  return name.replace(/[^a-zA-Z0-9_-]/g, '_')
}

function toJsonSchema(value: unknown): Readonly<JSONSchema7> {
  const parsed = JsonObjectSchema.safeParse(value)
  return parsed.success ? (parsed.data as JSONSchema7) : fallbackSchema
}

function normalizeMcpInputTool(input: z.infer<typeof McpInputToolSchema>): McpInputTool {
  return {
    name: input.name,
    ...(input.description === undefined ? {} : { description: input.description }),
    ...(input.inputSchema === undefined ? {} : { inputSchema: input.inputSchema }),
  }
}

function getMcpInputTools(payload: McpToolsPayload) {
  if (Array.isArray(payload)) return payload
  if ('tools' in payload) return payload.tools
  return payload.result.tools
}

function parseMcpToolsFromPayload(payload: unknown): McpInputTool[] {
  const parsed = McpToolsPayloadSchema.safeParse(payload)
  if (!parsed.success) return []
  return getMcpInputTools(parsed.data).map(normalizeMcpInputTool)
}

function mapImportedMcpToolToTaskyonTool(input: McpInputTool, sourceName?: string): ToolBase {
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

const parsedImportedMcpTools = computed(() => parseMcpToolsFromPayload(mcpPayload.value))

const importedMcpToolOptions = computed(() => parsedImportedMcpTools.value.map((t) => t.name))
const exampleOptions = computed(() => mcpExamples.map((e) => ({ label: e.label, value: e.id })))
const selectedExampleMeta = computed(() =>
  mcpExamples.find((example) => example.id === selectedExampleId.value),
)

function syncToolDraftFromSelection() {
  const selected = parsedImportedMcpTools.value.find(
    (t) => t.name === selectedImportedMcpToolName.value,
  )
  if (!selected) return
  toolDraft.value = mapImportedMcpToolToTaskyonTool(selected, serverName.value || undefined)
}

function selectImportedMcpTool(value: string | null) {
  if (!value) return
  selectedImportedMcpToolName.value = value
  syncToolDraftFromSelection()
}

function loadExample() {
  const selected = selectedExampleMeta.value
  if (!selected) return
  serverName.value = selected.serverName
  serverUrl.value = selected.serverUrl
  mcpPayload.value = selected.payload
  const firstTool = selected.payload.tools[0]
  if (!firstTool) return
  selectedImportedMcpToolName.value = firstTool.name
  syncToolDraftFromSelection()
}

function selectExample(value: string | null) {
  if (!value) return
  selectedExampleId.value = value
  loadExample()
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

async function mcpRpcRequest(url: string, id: number, method: string, params?: unknown) {
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json',
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id,
      method,
      ...(params !== undefined ? { params } : {}),
    }),
  })

  const body = (await response.json()) as Record<string, unknown>
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${JSON.stringify(body)}`)
  }
  if (body.error) {
    throw new Error(String(JSON.stringify(body.error)))
  }
  return body
}

async function fetchMcpTools() {
  if (!serverUrl.value.trim() && selectedExampleMeta.value?.serverUrl) {
    serverUrl.value = selectedExampleMeta.value.serverUrl
  }
  const url = serverUrl.value.trim()
  if (!url) {
    fetchStatus.value = 'Missing MCP server URL.'
    return
  }

  fetchStatus.value = 'Connecting to MCP server...'
  try {
    await mcpRpcRequest(url, 1, 'initialize', {
      protocolVersion: '2024-11-05',
      clientInfo: { name: 'taskyon-ui', version: '0.5.1' },
      capabilities: {},
    })
    await mcpRpcRequest(url, 2, 'notifications/initialized')
    const toolsResponse = await mcpRpcRequest(url, 3, 'tools/list')
    mcpPayload.value = toolsResponse

    const tools = parseMcpToolsFromPayload(toolsResponse)
    if (tools.length > 0) {
      selectedImportedMcpToolName.value = tools[0]?.name
      syncToolDraftFromSelection()
    }
    fetchStatus.value = `Loaded ${tools.length} tools from ${url}`
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    fetchStatus.value = `Failed to fetch MCP tools: ${message}`
  }
}
</script>
