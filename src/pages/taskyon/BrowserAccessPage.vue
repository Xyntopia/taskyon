<template>
  <FadeAwayScrollPage padding class="browser-access-page">
    <div class="row items-center q-col-gutter-md q-mb-md">
      <div class="col">
        <div class="text-h6">Browser Access</div>
        <div class="text-body2 text-grey-7">
          Configure how Taskyon reaches the web for research and inspect current activity.
        </div>
      </div>
      <div class="col-auto row q-gutter-sm">
        <q-btn flat dense label="Settings" to="/settings/agent%20config" />
        <q-btn flat dense label="Import MCP" @click="runBrowserMcpImport" />
      </div>
    </div>

    <div class="row q-col-gutter-xl">
      <div class="col-12 col-lg-7 column q-gutter-xl">
        <section>
          <div class="text-subtitle1 q-mb-sm">ChatCompletion Web Search</div>
          <ObjectView
            v-model="entryNodeWebSearchModel"
            :schema="entryNodeWebSearchSchema"
            :icons="entryNodeWebSearchIcons"
            missing-mode="placeholders"
          />
        </section>

        <section>
          <div class="text-subtitle1 q-mb-sm">Browser MCP</div>
          <ObjectView
            v-model="browserMcpModel"
            :schema="browserAccessMcpSchema"
            :icons="iconRegistry.importBrowserMcpTools as iconMap"
            missing-mode="placeholders"
          />
        </section>

        <section>
          <div class="text-subtitle1 q-mb-sm">Startup Guide</div>
          <ObjectView
            v-model="browserEnsureModel"
            :schema="browserAccessEnsureSchema"
            :icons="iconRegistry.ensureBrowserMcpTools as iconMap"
            missing-mode="placeholders"
          />
        </section>

        <section>
          <div class="text-subtitle1 q-mb-sm">Proxy Fallback</div>
          <ObjectView
            v-model="browserProxyModel"
            :schema="browserAccessProxySchema"
            :icons="iconRegistry.proxyWebReader as iconMap"
            missing-mode="placeholders"
          />
        </section>

        <section>
          <div class="text-subtitle1 q-mb-sm">Research Defaults</div>
          <ObjectView
            v-model="browserResearchModel"
            :schema="browserAccessResearchSchema"
            :icons="iconRegistry.webResearchPlanner as iconMap"
            missing-mode="placeholders"
          />
        </section>
      </div>

      <div class="col-12 col-lg-5 column q-gutter-xl">
        <section>
          <div class="row items-center justify-between q-mb-sm">
            <div class="text-subtitle1">Live Activity</div>
            <div class="text-caption text-grey-7">{{ connectionSummary }}</div>
          </div>

          <div v-if="currentActivity" class="column q-gutter-sm">
            <div><strong>Mode:</strong> {{ currentActivity.kind }}</div>
            <div><strong>Tool:</strong> {{ currentActivity.toolName }}</div>
            <div><strong>Status:</strong> {{ currentActivity.status }}</div>
            <div><strong>Summary:</strong> {{ currentActivity.summary }}</div>
            <div v-if="currentActivity.url">
              <strong>URL:</strong>
              <a :href="currentActivity.url" target="_blank" rel="noreferrer">{{
                currentActivity.url
              }}</a>
            </div>
            <div v-if="currentActivity.query">
              <strong>Query:</strong> {{ currentActivity.query }}
            </div>
            <div><strong>Time:</strong> {{ currentActivityTime }}</div>
          </div>
          <div v-else class="text-grey-7">No browser-access activity observed yet.</div>
        </section>

        <section>
          <div class="text-subtitle1 q-mb-sm">Browser Preview</div>
          <div v-if="currentPreviewImageUrl" class="column q-gutter-sm">
            <q-img :src="currentPreviewImageUrl" fit="contain" style="min-height: 16rem" />
          </div>
          <div v-else class="text-grey-7">
            Browser MCP previews will appear here when a browser-capable tool emits one. Proxy and
            chatCompletion discovery do not provide screenshots in this version.
          </div>
        </section>

        <section>
          <div class="text-subtitle1 q-mb-sm">Recent Activity</div>
          <q-list bordered separator>
            <q-item v-for="activity in recentActivities" :key="activity.id">
              <q-item-section>
                <q-item-label>{{ activity.summary }}</q-item-label>
                <q-item-label caption>
                  {{ activity.toolName }} · {{ activity.status }} ·
                  {{ formatActivityTime(activity.timestamp) }}
                </q-item-label>
              </q-item-section>
            </q-item>
            <q-item v-if="recentActivities.length === 0">
              <q-item-section>
                <q-item-label caption>No recent browser-access activity yet.</q-item-label>
              </q-item-section>
            </q-item>
          </q-list>
        </section>
      </div>
    </div>
  </FadeAwayScrollPage>
</template>

<script setup lang="ts">
import FadeAwayScrollPage from '@taskyon/ui/components/FadeAwayScrollPage.vue'
import ObjectView from '@taskyon/ui/components/varViews/ObjectView.vue'
import { forgeTaskChain, type FunctionArguments, type TaskNode } from '@taskyon/taskyon'
import { toolCall, type partialTaskDraft } from '@taskyon/taskyon/api'
import { createTaskyonClient } from '@taskyon/tyclient'
import type { JSONSchema7 } from 'json-schema'
import type { iconMap } from 'src/modules/icons'
import { iconRegistry } from 'src/modules/icons'
import {
  browserAccessEnsureDefaults,
  browserAccessEnsureSchema,
  browserAccessMcpDefaults,
  browserAccessMcpSchema,
  browserAccessProxyDefaults,
  browserAccessProxySchema,
  browserAccessResearchDefaults,
  browserAccessResearchSchema,
  extractBrowserAccessActivity,
  type BrowserAccessActivity,
} from 'src/modules/taskyon/browserAccess'
import { useAppStateStore } from 'src/stores/appState'
import { useTaskyonStore } from 'src/stores/taskyonState'
import { computed, onMounted, ref } from 'vue'

const state = useAppStateStore()
const tystate = useTaskyonStore()
const taskyonClient = createTaskyonClient(tystate.api)

const entryToolName = computed(() => state.llmSettings.entryFunction)

const isNestedIconMap = (value: string | iconMap | undefined): value is iconMap =>
  typeof value === 'object' && value !== null

const entryNodeWebSearchIcons = computed(() => {
  const entryNodeIcons = iconRegistry.entryNode
  if (!isNestedIconMap(entryNodeIcons)) return {}
  const websearchIcons = entryNodeIcons.websearch
  return isNestedIconMap(websearchIcons) ? websearchIcons : {}
})

const entryNodeWebSearchSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    enabled: {
      type: 'boolean',
      description: 'Enable chatCompletion web search for discovery.',
    },
    max_results: {
      type: 'integer',
      minimum: 1,
      description: 'Maximum number of web-search results to request.',
    },
  },
  required: [],
} as const satisfies JSONSchema7

const ensureToolchainObject = <T extends FunctionArguments>(key: string, defaults: T): T => {
  const current = state.toolchainProfiles.base[key]
  if (!current || typeof current !== 'object' || Array.isArray(current)) {
    state.toolchainProfiles.base[key] = structuredClone(defaults)
  }
  return state.toolchainProfiles.base[key] as T
}

const browserMcpModel = computed({
  get: () => ensureToolchainObject('importBrowserMcpTools', browserAccessMcpDefaults),
  set: (value) => {
    state.toolchainProfiles.base.importBrowserMcpTools = value
    const ensureSettings = ensureToolchainObject(
      'ensureBrowserMcpTools',
      browserAccessEnsureDefaults,
    )
    ensureSettings.serverUrl = value.serverUrl
    ensureSettings.serverName = value.serverName
    if (Array.isArray(value.toolNames)) {
      ensureSettings.toolNames = value.toolNames
    }
  },
})

const browserEnsureModel = computed({
  get: () => ensureToolchainObject('ensureBrowserMcpTools', browserAccessEnsureDefaults),
  set: (value) => {
    state.toolchainProfiles.base.ensureBrowserMcpTools = value
  },
})

const browserProxyModel = computed({
  get: () => ensureToolchainObject('proxyWebReader', browserAccessProxyDefaults),
  set: (value) => {
    state.toolchainProfiles.base.proxyWebReader = value
  },
})

const browserResearchModel = computed({
  get: () => ensureToolchainObject('webResearchPlanner', browserAccessResearchDefaults),
  set: (value) => {
    state.toolchainProfiles.base.webResearchPlanner = value
  },
})

const entryNodeWebSearchModel = computed({
  get: () => {
    const entrySettings = ensureToolchainObject(entryToolName.value, { websearch: {} })
    const websearch =
      entrySettings.websearch && typeof entrySettings.websearch === 'object'
        ? (entrySettings.websearch as Record<string, unknown>)
        : {}
    return {
      enabled: typeof websearch.enabled === 'boolean' ? websearch.enabled : true,
      max_results: typeof websearch.max_results === 'number' ? websearch.max_results : 5,
    }
  },
  set: (value) => {
    const entrySettings = ensureToolchainObject(entryToolName.value, { websearch: {} })
    entrySettings.websearch = value
  },
})

const activities = ref<BrowserAccessActivity[]>([])

const upsertActivity = (task: TaskNode) => {
  const nextActivity = extractBrowserAccessActivity(task)
  if (!nextActivity) return
  activities.value = [
    nextActivity,
    ...activities.value.filter((entry) => entry.id !== nextActivity.id),
  ].slice(0, 20)
}

onMounted(async () => {
  browserMcpModel.value = {
    ...browserMcpModel.value,
  }
  const ty = await tystate.taskyon
  ty.taskStream(({ data }) => {
    if (!data) return
    upsertActivity(data)
  })
})

const currentActivity = computed(() => activities.value[0])
const currentPreviewImageUrl = computed(() => currentActivity.value?.previewImageUrl)
const recentActivities = computed(() => activities.value.slice(0, 8))
const currentActivityTime = computed(() =>
  currentActivity.value ? formatActivityTime(currentActivity.value.timestamp) : 'N/A',
)

const connectionSummary = computed(() => {
  if (tystate.activeTaskIds.size > 0) {
    return `${tystate.activeTaskIds.size} active task${tystate.activeTaskIds.size === 1 ? '' : 's'}`
  }
  return 'idle'
})

const formatActivityTime = (timestamp: number) =>
  new Date(timestamp).toLocaleString(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  })

const runBrowserMcpImport = async () => {
  const toolTask = toolCall({
    name: 'ensureBrowserMcpTools',
    arguments: {
      ...browserMcpModel.value,
      ...browserEnsureModel.value,
    },
  }) as partialTaskDraft
  const parentIds = state.selectedTaskId ? [state.selectedTaskId] : []
  const tasks = await forgeTaskChain([[toolTask]], parentIds)
  await taskyonClient.task.createChain({
    tasks,
    execute: true,
    show: true,
  })
}
</script>
