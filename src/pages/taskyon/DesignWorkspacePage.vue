<template>
  <q-page class="design-page column no-wrap">
    <SplitTaskyonView
      class="col column"
      :configuration="chatConfiguration"
      :tools="chatTools"
      :name="`design-${projectId}`"
      profile-name="design_workspace"
      :binding-key="state.bindingKey"
      missing-binding-key-policy="noBindingKey"
      persist
      initial-chat-open
      :chat-size="40"
    >
      <section class="design-workspace col column no-wrap">
        <header class="design-toolbar row items-center no-wrap q-gutter-sm">
          <div class="text-subtitle1 ellipsis">
            {{ project?.revision.displayName ?? projectId }}
          </div>
          <q-chip v-if="project" dense outline color="positive">
            {{ shortHash(project.revision.id) }}
          </q-chip>
          <q-space />
          <q-select
            v-if="project"
            :model-value="project.invocationName"
            :options="invocationNames"
            dense
            outlined
            label="Invocation"
            class="invocation-select"
            @update:model-value="selectInvocation"
          />
          <q-btn flat round dense icon="refresh" aria-label="Reload project" @click="loadProject" />
          <q-btn
            unelevated
            dense
            color="secondary"
            label="Run"
            :loading="evaluating"
            :disable="!project"
            @click="runInvocation"
          />
        </header>

        <div v-if="loading" class="col flex flex-center">
          <q-spinner-orbit color="secondary" size="3rem" />
        </div>
        <q-banner v-else-if="loadError" class="bg-negative text-white q-ma-md" rounded>
          {{ loadError }}
          <template #action><q-btn flat label="Retry" @click="loadProject" /></template>
        </q-banner>
        <template v-else-if="project">
          <q-tabs v-model="activeTab" dense align="left" class="design-tabs">
            <q-tab name="graph" icon="account_tree" label="Graph" />
            <q-tab name="node" icon="code" label="Node" :disable="!selectedNode" />
            <q-tab name="run" icon="play_arrow" label="Run" />
            <q-tab name="git" icon="sync" label="Git" />
          </q-tabs>
          <q-separator />
          <q-tab-panels v-model="activeTab" animated class="col design-panels">
            <q-tab-panel name="graph" class="fit q-pa-none">
              <GraphCanvas
                class="fit"
                :graph="project.graphData"
                v-bind="selectedNodeHash ? { selectedNodeId: selectedNodeHash } : {}"
                @select-node="selectGraphNode"
              />
            </q-tab-panel>
            <q-tab-panel name="node" class="fit q-pa-none">
              <DagNodeViewer
                v-if="selectedNode"
                :model-value="selectedNode.source"
                :label="selectedNode.label"
                :path="selectedNode.path"
                :local-name="selectedNode.localName"
                :hash="selectedNode.hash"
                :input-schema="selectedNode.inputSchema"
                :output-schema="selectedNode.outputSchema"
                :upstream-nodes="selectedNode.upstream.map(navigationItem)"
                :downstream-nodes="selectedNode.downstream.map(navigationItem)"
                show-navigation
                class="fit"
                @select-node="selectGraphNode"
              />
            </q-tab-panel>
            <q-tab-panel name="run" class="run-panel q-pa-md">
              <q-input
                v-model="paramsJson"
                type="textarea"
                autogrow
                outlined
                label="Constant parameters (JSON)"
              />
              <q-banner v-if="evaluationError" class="bg-negative text-white" rounded>
                {{ evaluationError }}
              </q-banner>
              <div v-if="run" class="text-caption">
                Run {{ shortHash(run.id) }} · {{ run.status }} ·
                {{ Object.keys(run.artifacts).length }} artifacts
              </div>
              <pre v-if="result !== null" class="result-output">{{ formattedResult }}</pre>
            </q-tab-panel>
            <q-tab-panel name="git" class="fit q-pa-none">
              <DesignGraphGitSyncPane
                scope-label="Selected project"
                :settings="gitSettings"
                :synchronize="synchronizeGit"
                @update-settings="Object.assign(gitSettings, $event)"
              />
            </q-tab-panel>
          </q-tab-panels>
        </template>
      </section>
    </SplitTaskyonView>
  </q-page>
</template>

<script setup lang="ts">
import type { Hash } from '@taskyon/comp-dag/caching'
import type { InvocationRun } from '@taskyon/comp-dag/designGraphModel'
import { createStorageInvocationArtifactStore } from '@taskyon/comp-dag/storageInvocationArtifacts'
import {
  createChatCompletionTask,
  createClientTool,
  type partialTyConfiguration,
} from '@taskyon/tyclient'
import DagNodeViewer from '@taskyon/ui/components/DagNodeViewer.vue'
import DesignGraphGitSyncPane from '@taskyon/ui/components/DesignGraphGitSyncPane.vue'
import GraphCanvas from '@taskyon/ui/components/GraphCanvas.vue'
import SplitTaskyonView from '@taskyon/ui/components/SplitTaskyonView.vue'
import { syncStateWithStorageClient } from '@taskyon/ui/modules/storageState'
import {
  synchronizeBrowserDesignGraph,
  type BrowserDagGitCredentials,
  type BrowserDesignGraphGitSettings,
} from '@taskyon/runtime-browser'
import { bundledDesignExamples } from 'src/modules/bundledDesignExamples'
import {
  defaultDesignParams,
  designNodeViewerData,
  ensureBundledDesignProject,
  evaluateDesign,
  loadDesignWorkspaceProject,
  type DesignNodeViewerData,
  type DesignWorkspaceProject,
} from 'src/modules/designWorkspaceRuntime'
import { useAppStateStore } from 'src/stores/appState'
import { useTaskyonStore } from 'src/stores/taskyonState'
import { computed, onBeforeUnmount, onMounted, reactive, ref, shallowRef, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'

const route = useRoute()
const router = useRouter()
const state = useAppStateStore()
const tystate = useTaskyonStore()
const projectId = computed(() => String(route.params.projectId || 'ai-workstation'))
const revisionId = computed(() =>
  route.params.revisionId ? (String(route.params.revisionId) as Hash) : undefined,
)
const projectRef = computed(() =>
  route.params.refName
    ? `projects/${encodeURIComponent(projectId.value)}${
        route.params.refName === 'main' ? '' : `/branches/${String(route.params.refName)}`
      }`
    : `projects/${encodeURIComponent(projectId.value)}`,
)
const invocationName = ref(String(route.query.invocation || 'main'))
const project = shallowRef<DesignWorkspaceProject | null>(null)
const selectedNodeHash = ref<string>()
const selectedNode = shallowRef<DesignNodeViewerData | null>(null)
const activeTab = ref('graph')
const paramsJson = ref('{}')
const result = shallowRef<unknown>(null)
const run = shallowRef<InvocationRun | null>(null)
const loading = ref(true)
const evaluating = ref(false)
const loadError = ref('')
const evaluationError = ref('')
const gitSettings = reactive<BrowserDesignGraphGitSettings>({
  remoteUrl: '',
  branch: 'main',
  authorName: '',
  authorEmail: '',
  commitMessage: 'Synchronize Taskyon project',
  corsProxy: '',
})

const shortHash = (value: string) => value.replace(/^sha256:/, '').slice(0, 10)
const invocationNames = computed(() => Object.keys(project.value?.revision.invocations ?? {}))
const formattedResult = computed(() => JSON.stringify(result.value, null, 2))
const activeStore = () => tystate.designProjectStore(projectId.value)
const navigationItem = (item: DesignNodeViewerData['upstream'][number]) => ({
  id: item.hash,
  label: item.label,
  caption: item.localName,
})

const selectGraphNode = (id: string) => {
  if (!project.value || !project.value.graph[id as Hash]) return
  selectedNodeHash.value = id
  selectedNode.value = designNodeViewerData(project.value, id as Hash)
  activeTab.value = 'node'
}

const selectInvocation = (name: string | null) => {
  if (!name) return
  invocationName.value = name
  void router.replace({ query: { ...route.query, invocation: name } })
  void loadProject()
}

const loadProject = async () => {
  loading.value = true
  loadError.value = ''
  try {
    const store = activeStore()
    if (projectId.value === 'ai-workstation' || bundledDesignExamples[projectId.value]) {
      await ensureBundledDesignProject({
        projectId: projectId.value,
        store: store.objects,
        repository: store.repository,
        refName: projectRef.value,
      })
    }
    project.value = await loadDesignWorkspaceProject({
      store: store.objects,
      repository: store.repository,
      checkout: revisionId.value
        ? { kind: 'revision', id: revisionId.value }
        : { kind: 'ref', name: projectRef.value },
      invocationName: invocationName.value,
    })
    invocationName.value = project.value.invocationName
    paramsJson.value = JSON.stringify(defaultDesignParams(project.value), null, 2)
    selectedNodeHash.value = project.value.invocation.rootNodeId
    selectedNode.value = designNodeViewerData(project.value, project.value.invocation.rootNodeId)
    await tystate.registerDesignProject({
      projectId: projectId.value,
      title: project.value.revision.displayName,
      refName: projectRef.value,
    })
  } catch (error) {
    project.value = null
    loadError.value = error instanceof Error ? error.message : String(error)
  } finally {
    loading.value = false
  }
}

const runInvocation = async () => {
  if (!project.value) return
  evaluating.value = true
  evaluationError.value = ''
  try {
    const params = JSON.parse(paramsJson.value) as unknown
    if (!params || typeof params !== 'object' || Array.isArray(params)) {
      throw new Error('Constant parameters must be a JSON object.')
    }
    const store = activeStore()
    const completed = await evaluateDesign({
      project: project.value,
      repository: store.repository,
      artifacts: createStorageInvocationArtifactStore(tystate.storageClient, () =>
        crypto.randomUUID(),
      ),
      params: params as Record<string, unknown>,
      makeAttemptId: () => crypto.randomUUID(),
    })
    result.value = completed.value
    run.value = completed.run
    activeTab.value = 'run'
  } catch (error) {
    evaluationError.value = error instanceof Error ? error.message : String(error)
  } finally {
    evaluating.value = false
  }
}

const synchronizeGit = async (credentials?: BrowserDagGitCredentials) =>
  await synchronizeBrowserDesignGraph({
    storageClient: tystate.storageClient,
    selector: { kind: 'project', projectRef: projectRef.value },
    settings: gitSettings,
    ...(credentials ? { credentials } : {}),
  })

const chatTools = [
  createClientTool({
    name: 'designAssistant',
    description: 'Help inspect and evaluate the active immutable design-graph project.',
    parameters: { type: 'object', properties: {}, additionalProperties: false } as const,
    function: (_args, ctx) =>
      ctx.createSubtasksResult([
        createChatCompletionTask({
          appendSystemPrompts: [
            'You are collaborating in a Taskyon project workspace. Inspect the exact selected project and invocation before making recommendations.',
          ],
          allowedTools: ['inspectDesignWorkspace'],
        }),
      ]),
  }),
  createClientTool({
    name: 'inspectDesignWorkspace',
    description: 'Inspect the selected project revision, invocation, parameters, and latest run.',
    parameters: { type: 'object', properties: {}, additionalProperties: false } as const,
    function: () => ({
      projectId: projectId.value,
      projectRevision: project.value?.revision,
      invocationName: project.value?.invocationName,
      invocation: project.value?.invocation,
      parameters: paramsJson.value,
      run: run.value,
      result: result.value,
    }),
  }),
]

const chatConfiguration = computed<partialTyConfiguration | null>(() => {
  const key = tystate.getTaskyonKeyString()
  return key === null
    ? null
    : {
        llmSettings: { entryFunction: 'designAssistant' },
        appConfiguration: {
          guiMode: 'minChat',
          expertMode: true,
          showLogo: false,
          chatSuggestions: [],
          welcomeMsg: 'Ask about the selected project, invocation, graph, or latest run.',
        },
        signatureOrKey: key,
      }
})

let gitSettingsStorage: Awaited<ReturnType<typeof syncStateWithStorageClient>> | undefined
onMounted(async () => {
  await loadProject()
  gitSettingsStorage = await syncStateWithStorageClient(
    tystate.storageClient,
    { namespace: 'taskyon/ui-state/v1', id: `design-git:${projectId.value}` },
    { gitSettings },
  )
})
onBeforeUnmount(() => {
  gitSettingsStorage?.stop()
  void gitSettingsStorage?.flush()
})
watch([projectId, revisionId], () => void loadProject())
</script>

<style scoped>
.design-page,
.design-workspace,
.design-panels {
  min-height: 0;
}

.design-toolbar {
  min-height: 3.5rem;
  padding: 0.5rem 0.75rem;
}

.invocation-select {
  width: min(18rem, 35vw);
}

.design-tabs {
  flex: 0 0 auto;
}

.run-panel {
  display: grid;
  align-content: start;
  gap: 1rem;
  overflow: auto;
}

.result-output {
  max-width: 100%;
  overflow: auto;
  white-space: pre-wrap;
}
</style>
