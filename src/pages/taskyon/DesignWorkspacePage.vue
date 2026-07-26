<template>
  <q-page class="design-page column">
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
      :chat-size="50"
    >
      <section class="design-workspace column no-wrap">
        <header class="design-toolbar row items-center no-wrap">
          <div class="design-title ellipsis">{{ projectTitle }}</div>
          <q-chip v-if="project" dense outline color="positive" :icon="matVerified">
            {{ shortHash(project.revision.id) }}
            <q-tooltip>{{ project.revision.id }}</q-tooltip>
          </q-chip>
          <q-space />
          <q-btn
            flat
            round
            dense
            :icon="matSearch"
            aria-label="Search designs"
            @click="openDesignSearch"
          >
            <q-tooltip>Search designs</q-tooltip>
          </q-btn>
          <q-select
            v-if="!checkoutRevisionId"
            :model-value="selectedRef"
            :options="refOptions"
            dense
            outlined
            hide-bottom-space
            label="Ref"
            class="toolbar-select"
            @update:model-value="selectRef"
          />
          <q-chip v-else dense square outline color="secondary">
            Revision {{ shortHash(checkoutRevisionId) }}
            <q-tooltip>{{ checkoutRevisionId }}</q-tooltip>
          </q-chip>
          <q-select
            :model-value="selectedRoot"
            :options="rootOptions"
            dense
            outlined
            hide-bottom-space
            label="Root"
            class="toolbar-select"
            @update:model-value="selectRoot"
          />
        </header>

        <div v-if="loading" class="col flex flex-center">
          <div class="column items-center q-gutter-md">
            <q-spinner-orbit color="secondary" size="3rem" />
            <div class="text-subtitle1">Building the design workspace…</div>
          </div>
        </div>

        <q-banner v-else-if="loadError" class="bg-negative text-white q-ma-md" rounded>
          {{ loadError }}
          <template #action>
            <q-btn flat label="Retry" @click="loadProject" />
          </template>
        </q-banner>

        <template v-else-if="project">
          <div class="design-content col">
            <DockView
              v-model:node="designDockLayout"
              class="design-workspace-dock"
              hide-tab-add
              :pinned-views="['design', 'graph']"
              :tab-icons="designDockTabIcons"
              :tab-titles="designDockTabTitles"
            >
              <template #design>
                <div class="design-primary fit">
                  <q-card flat bordered class="workspace-pane controls-card">
                    <div class="compact-panel-header row items-center no-wrap">
                      <div class="panel-title">Parameters</div>
                      <div v-if="designInputSummary.length" class="panel-summary ellipsis">
                        {{ designInputCaption }}
                      </div>
                      <q-space />
                      <q-toggle
                        v-model="autoEvaluate"
                        dense
                        color="secondary"
                        label="Live"
                        @update:model-value="onAutoEvaluateChanged"
                      />
                      <q-btn
                        flat
                        round
                        dense
                        :icon="matRefresh"
                        title="Reset parameters"
                        @click="resetParams"
                      />
                      <q-btn
                        unelevated
                        dense
                        color="secondary"
                        label="Run"
                        :loading="evaluating"
                        @click="requestEvaluation"
                      />
                      <q-btn
                        flat
                        dense
                        color="secondary"
                        :icon="matScience"
                        label="Optimize"
                        :class="{ 'optimization-mode-button--active': optimizationMode }"
                        @click="optimizationMode = !optimizationMode"
                      />
                    </div>
                    <q-separator />
                    <q-scroll-area class="workspace-pane-scroll">
                      <div class="compact-object-view">
                        <div v-if="optimizationMode" class="optimization-mode-bar">
                          <div class="optimization-mode-summary">
                            <div>
                              <div class="panel-title">Optimization setup</div>
                              <div class="panel-summary">{{ optimizationCaption }}</div>
                            </div>
                            <q-space />
                            <q-btn
                              unelevated
                              dense
                              color="secondary"
                              label="Run study"
                              :loading="studying"
                              :disable="
                                localSweepVariables.length === 0 && structuralAlternativeCount === 0
                              "
                              @click="runStudy"
                            />
                          </div>
                          <q-input v-model="objectivePath" dense outlined label="Objective path" />
                          <div class="optimization-hint">
                            Enable variables below and constrain which search methods may use each
                            one. The current study runner uses the local sweep method.
                          </div>
                          <q-banner
                            v-if="structuralAlternativeCount"
                            dense
                            rounded
                            class="structural-banner"
                          >
                            {{ structuralAlternativeCount }} structural alternatives are evaluated
                            lazily; requirements remain fixed.
                          </q-banner>
                        </div>
                        <ObjectView
                          :model-value="params"
                          :schema="paramsSchema"
                          :renderers="designRenderers"
                          missing-mode="all"
                          :default-expanded-depth="2"
                          @update:model-value="onParamsChanged"
                        />
                      </div>
                    </q-scroll-area>
                  </q-card>

                  <q-card flat bordered class="workspace-pane result-card">
                    <div class="compact-panel-header row items-center no-wrap">
                      <q-badge :color="result ? 'positive' : 'grey'" rounded />
                      <div class="panel-title q-ml-xs">Live result</div>
                      <div class="panel-summary ellipsis">{{ evaluationStatus }}</div>
                      <q-space />
                      <q-btn
                        flat
                        dense
                        color="secondary"
                        label="Save"
                        :disable="!evaluation"
                        @click="saveDialog = true"
                      />
                    </div>
                    <q-separator />
                    <q-tabs
                      v-model="resultTab"
                      dense
                      narrow-indicator
                      align="left"
                      active-color="secondary"
                      class="compact-result-tabs"
                    >
                      <q-tab name="result" label="Result" />
                      <q-tab v-if="visualizationHtml" name="visualization" label="Visual" />
                      <q-tab v-if="studyResult" name="study" label="Study" />
                    </q-tabs>
                    <q-separator />
                    <q-tab-panels v-model="resultTab" animated class="result-panels">
                      <q-tab-panel name="result" class="scroll compact-tab-panel">
                        <q-banner v-if="evaluationError" class="bg-negative text-white" rounded>
                          {{ evaluationError }}
                        </q-banner>
                        <ObjectView
                          v-else-if="resultObject"
                          :model-value="resultObject"
                          :schema="outputSchema"
                          read-only
                          copy-object-btn
                          :default-expanded-depth="2"
                        />
                        <div
                          v-else
                          class="empty-result column items-center justify-center text-grey-6"
                        >
                          <q-icon :name="matPlayCircle" size="3rem" />
                          <span>Adjust parameters or run this root.</span>
                        </div>
                      </q-tab-panel>
                      <q-tab-panel name="visualization" class="q-pa-none">
                        <iframe
                          ref="visualizationFrame"
                          class="visualization-frame"
                          title="Design result visualization"
                          sandbox="allow-scripts"
                          :srcdoc="sandboxedVisualization"
                          @load="connectVisualizationRenderer"
                        />
                      </q-tab-panel>
                      <q-tab-panel name="study" class="scroll compact-tab-panel">
                        <div v-if="studyResult" class="q-gutter-sm">
                          <q-banner dense rounded class="bg-positive text-white">
                            {{ studyResult.completedEvals }} designs · best row
                            {{ Number(studyResult.bestIndex ?? 0) + 1 }}
                          </q-banner>
                          <q-markup-table v-if="studyRows.length" flat bordered dense>
                            <thead>
                              <tr>
                                <th class="text-left">Design</th>
                                <th class="text-left">Status</th>
                                <th class="text-right">Score</th>
                                <th class="text-right">Price</th>
                                <th class="text-right">Memory</th>
                                <th class="text-left">Why rejected</th>
                              </tr>
                            </thead>
                            <tbody>
                              <tr
                                v-for="row in studyRows"
                                :key="`${row.index}:${row.id}`"
                                :class="{ 'study-row--best': row.best }"
                              >
                                <td>{{ row.name }}</td>
                                <td>
                                  <q-badge :color="row.viable ? 'positive' : 'negative'">
                                    {{ row.viable ? 'Feasible' : 'Rejected' }}
                                  </q-badge>
                                </td>
                                <td class="text-right">{{ row.score.toFixed(1) }}</td>
                                <td class="text-right">${{ row.price.toLocaleString() }}</td>
                                <td class="text-right">{{ row.memory }} GB</td>
                                <td class="study-reasons">{{ row.reasons || '—' }}</td>
                              </tr>
                            </tbody>
                          </q-markup-table>
                        </div>
                      </q-tab-panel>
                    </q-tab-panels>
                  </q-card>
                </div>
              </template>
              <template #graph>
                <div class="graph-pane fit column no-wrap">
                  <div class="graph-toolbar row items-center no-wrap">
                    <q-btn-toggle
                      v-model="graphLayout"
                      dense
                      no-caps
                      flat
                      text-color="grey-7"
                      :options="[
                        { label: 'Flow', value: 'flow' },
                        { label: 'Vertical', value: 'vertical' },
                        { label: 'Organic', value: 'organic' },
                      ]"
                    />
                    <q-separator vertical />
                    <ToggleButton
                      v-model="showDesignRecords"
                      dense
                      flat
                      no-caps
                      color="grey-7"
                      label="Records"
                    >
                      <q-tooltip>Show revision, design-space, history, and ref records</q-tooltip>
                    </ToggleButton>
                    <ToggleButton
                      v-if="hasMutableRef"
                      v-model="showMutableRefs"
                      dense
                      flat
                      no-caps
                      color="grey-7"
                      label="Refs"
                      :disable="!showDesignRecords"
                    >
                      <q-tooltip>Show mutable refs that point to immutable revisions</q-tooltip>
                    </ToggleButton>
                    <ToggleButton
                      v-model="showRecordHashes"
                      dense
                      flat
                      no-caps
                      color="grey-7"
                      label="Hashes"
                      :disable="!showDesignRecords"
                    >
                      <q-tooltip>Show content identities on design records</q-tooltip>
                    </ToggleButton>
                    <q-btn dense flat no-caps color="grey-7" label="Fit" @click="fitDesignGraph">
                      <q-tooltip>Zoom to fit</q-tooltip>
                    </q-btn>
                  </div>
                  <GraphCanvas
                    ref="designGraphCanvas"
                    class="graph-canvas-host col"
                    :graph="visibleGraphData"
                    :options="graphOptions"
                  />
                  <section class="graph-identity">
                    <span>Revision</span>
                    <code :title="project.revision.id">
                      {{ shortHash(project.revision.id) }}
                    </code>
                    <span>Root</span>
                    <code :title="project.revision.roots[project.rootName]?.nodeId">
                      {{ shortHash(project.revision.roots[project.rootName]?.nodeId ?? 'unknown') }}
                    </code>
                  </section>
                </div>
              </template>
              <template v-for="tab in openedNodeTabs" :key="tab.viewId" #[tab.viewId]>
                <DagNodeViewer
                  :model-value="tab.source"
                  :label="tab.label"
                  :path="tab.path"
                  :local-name="tab.localName"
                  :hash="tab.hash"
                  :input-schema="tab.inputSchema"
                  :output-schema="tab.outputSchema"
                  :upstream-nodes="tab.upstreamNodes"
                  :downstream-nodes="tab.downstreamNodes"
                  show-navigation
                  :standalone-to="nodeStandaloneRoute(tab.hash)"
                  class="fit"
                  @select-node="selectRelatedNode(tab.viewId, $event)"
                />
              </template>
            </DockView>
          </div>
        </template>
      </section>
    </SplitTaskyonView>

    <q-dialog v-model="saveDialog">
      <q-card style="min-width: 22rem">
        <q-card-section>
          <div class="text-h6">Save this design</div>
          <div class="text-caption text-grey-7">
            Name this exact revision, parameter set, and result.
          </div>
        </q-card-section>
        <q-card-section>
          <q-input v-model="designName" outlined autofocus label="Design name" />
        </q-card-section>
        <q-card-actions align="right">
          <q-btn v-close-popup flat label="Cancel" />
          <q-btn
            color="secondary"
            label="Save design"
            :disable="!designName.trim()"
            @click="saveDesign"
          />
        </q-card-actions>
      </q-card>
    </q-dialog>

    <q-dialog v-model="designSearchOpen">
      <q-card class="design-search-card">
        <q-card-section>
          <div class="text-h6">Open a design or project</div>
          <div class="text-caption text-grey-7">
            Search prepared designs and local Taskyon design projects.
          </div>
        </q-card-section>
        <q-card-section class="q-pt-none">
          <q-input
            v-model="designSearch"
            autofocus
            clearable
            outlined
            dense
            :loading="designSearchLoading"
            :error="Boolean(designSearchError)"
            :error-message="designSearchError"
            label="Search designs and projects"
          >
            <template #prepend><q-icon :name="matSearch" /></template>
          </q-input>
        </q-card-section>
        <q-separator />
        <q-list class="design-search-results" separator>
          <q-item
            v-for="entry in filteredDesigns"
            :key="entry.projectId"
            v-ripple
            clickable
            @click="openDesign(entry)"
          >
            <q-item-section avatar>
              <q-icon :name="matAccountTree" color="secondary" />
            </q-item-section>
            <q-item-section>
              <q-item-label>{{ entry.label }}</q-item-label>
              <q-item-label caption>{{ entry.projectId }} · {{ entry.refName }}</q-item-label>
            </q-item-section>
            <q-item-section side>
              <q-badge v-if="entry.prepared" outline color="secondary" label="Prepared design" />
              <q-badge v-else outline color="grey-7" label="Project" />
            </q-item-section>
          </q-item>
          <q-item v-if="!designSearchLoading && filteredDesigns.length === 0">
            <q-item-section class="text-grey-6 text-center q-py-lg">
              No matching designs or projects.
            </q-item-section>
          </q-item>
        </q-list>
        <q-card-actions align="right">
          <q-btn v-close-popup flat label="Close" />
        </q-card-actions>
      </q-card>
    </q-dialog>
  </q-page>
</template>

<script setup lang="ts">
import {
  matAccountTree,
  matCode,
  matPlayCircle,
  matRefresh,
  matSearch,
  matScience,
  matTune,
  matVerified,
} from '@quasar/extras/material-icons'
import { canonicalHash, type Hash } from '@taskyon/comp-dag/caching'
import type { DesignInputRole } from '@taskyon/comp-dag/designRevision'
import type { RenderOptions } from '@taskyon/common/modules/graph'
import {
  createChatCompletionTask,
  createClientTool,
  type partialTyConfiguration,
} from '@taskyon/tyclient'
import GraphCanvas from '@taskyon/ui/components/GraphCanvas.vue'
import DagNodeViewer from '@taskyon/ui/components/DagNodeViewer.vue'
import DockView, { type DockNode } from '@taskyon/ui/components/DockView.vue'
import SplitTaskyonView from '@taskyon/ui/components/SplitTaskyonView.vue'
import ToggleButton from '@taskyon/ui/components/ToggleButton.vue'
import DesignNumberField from '@taskyon/ui/components/varViews/DesignNumberField.vue'
import ObjectView from '@taskyon/ui/components/varViews/ObjectView.vue'
import type { CustomRenderer } from '@taskyon/ui/components/varViews/VariableField.vue'
import { useAppStateStore } from 'src/stores/appState'
import { useTaskyonStore } from 'src/stores/taskyonState'
import {
  defaultDesignParams,
  designOutputSchemaId,
  designNodeViewerData,
  ensureBundledDesignProject,
  evaluateDesign,
  evaluateDesignStudy,
  loadDesignWorkspaceProject,
  type DesignGraphNodeData,
  type DesignGraphRecordData,
  type DesignWorkspaceProject,
} from 'src/modules/designWorkspaceRuntime'
import { workstationVisualizationHtml } from 'src/modules/workstationVisualization'
import { bundledDesignExamples, bundledVisualizationId } from 'src/modules/bundledDesignExamples'
import {
  connectDesignRendererFrame,
  designRendererBootstrapSource,
  type DesignRendererHostConnection,
} from 'src/modules/designRendererProtocol'
import { computed, markRaw, nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import type { RouteLocationRaw } from 'vue-router'
import type { JSONSchema7 } from 'json-schema'

const route = useRoute()
const router = useRouter()
const state = useAppStateStore()
const tystate = useTaskyonStore()
const projectId = computed(() => String(route.params.projectId || 'ai-workstation'))
const checkoutRevisionId = computed(() =>
  route.params.revisionId ? (String(route.params.revisionId) as Hash) : null,
)
const selectedRef = ref(String(route.params.refName || 'main'))
const selectedRoot = ref('')
const refOptions = ref<string[]>([])
const project = ref<DesignWorkspaceProject | null>(null)
const params = ref<Record<string, unknown>>({})
const result = ref<unknown>(null)
const evaluation = ref<Awaited<ReturnType<typeof evaluateDesign>>['evaluation'] | null>(null)
const visualizationHtml = ref('')
const visualizationFrame = ref<HTMLIFrameElement | null>(null)
const loading = ref(true)
const loadError = ref('')
const evaluating = ref(false)
const studying = ref(false)
const evaluationError = ref('')
const autoEvaluate = ref(true)
const resultTab = ref('result')
const saveDialog = ref(false)
const designName = ref('')
const designSearchOpen = ref(false)
const designSearch = ref('')
const designSearchLoading = ref(false)
const designSearchError = ref('')
const localDesignProjects = ref<
  Array<{ projectId: string; title: string; refName: string; lastOpenedAtMs: number }>
>([])

type DesignSearchEntry = {
  projectId: string
  refName: string
  label: string
  prepared: boolean
  lastOpenedAtMs: number
}
type OptimizerId = 'local-sweep' | 'bayesian' | 'evolutionary' | 'gradient'

const optimizerOptions: Array<{ label: string; value: OptimizerId }> = [
  { label: 'Local sweep', value: 'local-sweep' },
  { label: 'Bayesian', value: 'bayesian' },
  { label: 'Evolutionary', value: 'evolutionary' },
  { label: 'Gradient / Newton', value: 'gradient' },
]
const defaultAllowedOptimizers: OptimizerId[] = ['local-sweep', 'bayesian', 'evolutionary']
const optimizationVariables = ref<string[]>([])
const allowedOptimizersByPath = ref<Record<string, OptimizerId[]>>({})
const optimizationMode = ref(false)
const objectivePath = ref('recommendation.score')
const studyResult = ref<Awaited<ReturnType<typeof evaluateDesignStudy>>['value'] | null>(null)
const initialDesignDockLayout = (): DockNode => ({
  id: 'design-tools',
  type: 'leaf',
  views: ['design', 'graph'],
  activeViewIndex: 0,
  showTabs: 'always',
  size: 1,
})
const designDockLayout = ref<DockNode>(initialDesignDockLayout())
const openedNodeViews = ref<Array<{ viewId: string; hash: Hash }>>([])
const designGraphCanvas = ref<InstanceType<typeof GraphCanvas> | null>(null)
const showDesignRecords = ref(true)
const showMutableRefs = ref(true)
const showRecordHashes = ref(true)
const graphLayout = ref<'flow' | 'vertical' | 'organic'>('flow')
let nodeViewSequence = 0
let evaluationTimer: ReturnType<typeof setTimeout> | null = null
let requestedVersion = 0
let queuedEvaluation = false
let visualizationConnection: DesignRendererHostConnection | null = null

const projectTitle = computed(() =>
  projectId.value === 'ai-workstation'
    ? 'AI Workstation'
    : (bundledDesignExamples[projectId.value]?.title ??
      projectId.value
        .split(/[-_]/)
        .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
        .join(' ')),
)
const designAssistantWelcome = computed(() => {
  const welcomeByProject: Record<string, string> = {
    'ai-workstation':
      'Configure a local AI workstation around your models, budget, and operating constraints.',
    'mission-drone':
      'Shape a mission-ready drone around its payload, range, endurance, and environment.',
    'mars-rover':
      'Design an autonomous Mars rover around its mission, terrain, power, and payload.',
    satellite: 'Balance the payload, orbit, power, communications, and launch constraints.',
    'home-battery':
      'Size a home battery system around your energy use, solar generation, tariffs, and backup needs.',
  }
  return (
    welcomeByProject[projectId.value] ??
    `Explore and refine ${projectTitle.value} against its requirements and tradeoffs.`
  )
})
function nodeStandaloneRoute(hash: Hash): RouteLocationRaw {
  if (checkoutRevisionId.value) {
    return {
      name: 'design-node-revision',
      params: {
        projectId: projectId.value,
        revisionId: checkoutRevisionId.value,
        rootName: project.value?.rootName ?? selectedRoot.value,
        nodeHash: hash,
      },
    }
  }
  return {
    name: 'design-node',
    params: {
      projectId: projectId.value,
      refName: selectedRef.value,
      rootName: project.value?.rootName ?? selectedRoot.value,
      nodeHash: hash,
    },
  }
}
const openedNodeTabs = computed(() =>
  openedNodeViews.value.flatMap(({ viewId, hash }) => {
    const currentProject = project.value
    if (!currentProject?.graph[hash]) return []
    const data = designNodeViewerData(currentProject, hash)
    const navigationItem = (node: (typeof data.upstream)[number]) => ({
      id: node.hash,
      label: node.label,
      caption: node.localName,
    })
    return [
      {
        viewId,
        ...data,
        upstreamNodes: data.upstream.map(navigationItem),
        downstreamNodes: data.downstream.map(navigationItem),
      },
    ]
  }),
)
const designDockTabTitles = computed(() => ({
  design: 'Design',
  graph: 'Design graph',
  ...Object.fromEntries(openedNodeTabs.value.map((tab) => [tab.viewId, tab.label])),
}))
const designDockTabIcons = computed(() => ({
  design: matTune,
  graph: matAccountTree,
  ...Object.fromEntries(openedNodeTabs.value.map((tab) => [tab.viewId, matCode])),
}))
const selectRelatedNode = (viewId: string, hash: string) => {
  openedNodeViews.value = openedNodeViews.value.map((view) =>
    view.viewId === viewId ? { ...view, hash: hash as Hash } : view,
  )
}
const openNodeDefinition = (hash: Hash) => {
  const existing = openedNodeViews.value.find((view) => view.hash === hash)
  const viewId = existing?.viewId ?? `node:${++nodeViewSequence}`
  if (!existing) openedNodeViews.value = [...openedNodeViews.value, { viewId, hash }]
  const views = designDockLayout.value.views ?? []
  const nextViews = views.includes(viewId) ? views : [...views, viewId]
  designDockLayout.value = {
    ...designDockLayout.value,
    views: nextViews,
    activeViewIndex: nextViews.indexOf(viewId),
  }
}
const availableDesigns = computed<DesignSearchEntry[]>(() => {
  const prepared: DesignSearchEntry[] = [
    {
      projectId: 'ai-workstation',
      refName: 'main',
      label: 'AI Workstation',
      prepared: true,
      lastOpenedAtMs: 0,
    },
    ...Object.values(bundledDesignExamples).map((example) => ({
      projectId: example.projectId,
      refName: 'main',
      label: example.title,
      prepared: true,
      lastOpenedAtMs: 0,
    })),
  ]
  const byId = new Map<string, DesignSearchEntry>(prepared.map((entry) => [entry.projectId, entry]))
  for (const entry of localDesignProjects.value) {
    const existing = byId.get(entry.projectId)
    byId.set(entry.projectId, {
      projectId: entry.projectId,
      refName: entry.refName,
      label: entry.title,
      prepared: Boolean(existing),
      lastOpenedAtMs: entry.lastOpenedAtMs,
    })
  }
  return [...byId.values()].sort(
    (left, right) =>
      right.lastOpenedAtMs - left.lastOpenedAtMs || left.label.localeCompare(right.label),
  )
})
const filteredDesigns = computed(() => {
  const query = designSearch.value.trim().toLowerCase()
  if (!query) return availableDesigns.value
  return availableDesigns.value.filter(
    (entry) =>
      entry.label.toLowerCase().includes(query) || entry.projectId.toLowerCase().includes(query),
  )
})
const rootOptions = computed(() => Object.keys(project.value?.revision.roots ?? {}))
const hasMutableRef = computed(() =>
  project.value?.graphData.nodes.some((node) => node.data?.kind === 'ref'),
)
const visibleGraphData = computed<DesignWorkspaceProject['graphData']>(() => {
  const graph = project.value?.graphData
  if (!graph) return { nodes: [], edges: [] }
  const nodes = graph.nodes.filter((node) => {
    if (node.data?.kind === 'computation') return true
    if (!showDesignRecords.value) return false
    return node.data?.kind !== 'ref' || showMutableRefs.value
  })
  const visibleIds = new Set(nodes.map((node) => node.id))
  return {
    nodes,
    edges: graph.edges.filter((edge) => visibleIds.has(edge.source) && visibleIds.has(edge.target)),
  }
})
const fitDesignGraph = () => designGraphCanvas.value?.fit()
const resultObject = computed<Record<string, unknown> | null>(() => {
  if (result.value === null || result.value === undefined) return null
  return typeof result.value === 'object' && !Array.isArray(result.value)
    ? (result.value as Record<string, unknown>)
    : { value: result.value }
})
const evaluationStatus = computed(() =>
  evaluating.value
    ? 'Evaluating the selected root…'
    : evaluation.value
      ? `Artifact ${shortHash(evaluation.value.resultArtifactId)}`
      : 'No completed evaluation yet',
)
const graphRecordData = (nodeId: string): DesignGraphRecordData | undefined =>
  project.value?.graphData.nodes.find((node) => node.id === nodeId)?.data
const graphNodeData = (nodeId: string): DesignGraphNodeData | undefined => {
  const data = graphRecordData(nodeId)
  return data?.kind === 'computation' ? data : undefined
}

const graphPortRow = (direction: 'input' | 'output', name: string, type: string): HTMLElement => {
  const row = document.createElement('div')
  row.className = `design-graph-port design-graph-port--${direction}`
  const portName = document.createElement('span')
  portName.className = 'design-graph-port-name'
  portName.textContent = direction === 'input' ? `→ ${name}` : `${name} →`
  const portType = document.createElement('span')
  portType.className = 'design-graph-port-type'
  portType.textContent = type
  portType.title = type
  row.append(portName, portType)
  return row
}

const graphNodeHtml = (nodeId: string, label: string, showHashes: boolean): HTMLElement | null => {
  const data = graphRecordData(nodeId)
  if (!data) return null
  const card = document.createElement('div')
  card.className = `design-graph-node-card design-graph-node-card--${data.kind}`
  const heading = document.createElement('div')
  heading.className = 'design-graph-node-heading'
  heading.textContent = label
  if (data.kind !== 'computation') {
    const kind = document.createElement('div')
    kind.className = 'design-graph-record-kind'
    kind.textContent =
      data.kind === 'ref'
        ? 'Mutable ref'
        : data.kind === 'design-space'
          ? `Design space · v${data.schemaVersion}`
          : data.kind === 'parent-revision'
            ? 'Immutable parent'
            : 'Immutable revision'
    card.append(kind, heading)
    if (showHashes) {
      const identity = document.createElement('code')
      identity.className = 'design-graph-record-hash'
      identity.textContent = data.kind === 'ref' ? shortHash(data.revisionId) : shortHash(data.hash)
      identity.title = data.kind === 'ref' ? data.revisionId : data.hash
      card.append(identity)
    }
    return card
  }
  const ports = document.createElement('div')
  ports.className = 'design-graph-ports'
  data.inputs.forEach((input) => ports.appendChild(graphPortRow('input', input.name, input.type)))
  ports.appendChild(graphPortRow('output', 'output', data.outputType))
  card.append(heading, ports)
  return card
}

const graphOptions = computed<RenderOptions>(() => {
  const showHashes = showRecordHashes.value
  const layout = graphLayout.value
  return {
    layoutMode: layout === 'organic' ? 'organic' : 'hierarchical',
    direction: layout === 'vertical' ? 'TB' : 'LR',
    enablePanZoom: true,
    enableNodeDrag: true,
    nodeWidth: 300,
    nodeHeight: (node) => {
      const data = graphNodeData(node.id)
      return data ? 50 + (data.inputs.length + 1) * 22 : 82
    },
    showDefaultNodeLabel: false,
    nodeHtmlPointerEvents: 'none',
    nodeHtml: (node) => graphNodeHtml(node.id, node.label ?? node.id, showHashes),
    onNodeClick: (node) => {
      const data = graphNodeData(node.id)
      if (data) openNodeDefinition(data.hash)
    },
    nodeStyle: (node) => {
      if (node.type === 'revision') {
        return { fill: '#fff3e8', stroke: '#ff8a3d', strokeWidth: 2 }
      }
      if (node.type === 'parent-revision') {
        return { fill: '#fff8e1', stroke: '#d9a11e', strokeWidth: 1.5 }
      }
      if (node.type === 'design-space') {
        return { fill: '#e8f8f5', stroke: '#26a69a', strokeWidth: 2 }
      }
      if (node.type === 'ref') {
        return { fill: '#eaf4ff', stroke: '#42a5f5', strokeWidth: 2 }
      }
      if (node.type === 'root') {
        const selected = graphNodeData(node.id)?.selectedRoot
        return {
          stroke: '#7c4dff',
          strokeWidth: 2,
          ...(selected ? { glowColor: '#7c4dff', glowBlur: 8 } : {}),
        }
      }
      return undefined
    },
    edgeStyle: (edge) => {
      if (edge.type === 'choice') return { stroke: '#7c4dff', dasharray: '5 4' }
      if (edge.type === 'design-space') return { stroke: '#26a69a', strokeWidth: 1.5 }
      if (edge.type === 'revision-root') return { stroke: '#ff8a3d', strokeWidth: 1.5 }
      if (edge.type === 'revision-parent') return { stroke: '#d9a11e', dasharray: '4 4' }
      if (edge.type === 'design-ref') return { stroke: '#42a5f5', dasharray: '5 3' }
      return undefined
    },
  }
})
const parameterPath = (node: { path: string[] }) => node.path.join('.')
const setOptimizationEnabled = (path: string, enabled: boolean) => {
  optimizationVariables.value = enabled
    ? [...new Set([...optimizationVariables.value, path])]
    : optimizationVariables.value.filter((candidate) => candidate !== path)
  if (enabled && !allowedOptimizersByPath.value[path]) {
    allowedOptimizersByPath.value = {
      ...allowedOptimizersByPath.value,
      [path]: [...defaultAllowedOptimizers],
    }
  }
}
const setAllowedOptimizers = (path: string, optimizers: string[]) => {
  const allowed = optimizers.filter((optimizer): optimizer is OptimizerId =>
    optimizerOptions.some((option) => option.value === optimizer),
  )
  allowedOptimizersByPath.value = { ...allowedOptimizersByPath.value, [path]: allowed }
}
const designRenderers: CustomRenderer[] = [
  {
    match: (node) => node.kind === 'number',
    component: markRaw(DesignNumberField),
    props: (node) => {
      const path = parameterPath(node)
      return {
        optimizationMode: optimizationMode.value,
        optimizable: numericParameterPaths.value.includes(path),
        optimizationEnabled: optimizationVariables.value.includes(path),
        allowedOptimizers: allowedOptimizersByPath.value[path] ?? [],
        optimizerOptions,
        onUpdateOptimizationEnabled: (enabled: boolean) => setOptimizationEnabled(path, enabled),
        onUpdateAllowedOptimizers: (optimizers: string[]) => setAllowedOptimizers(path, optimizers),
      }
    },
  },
]
const paramsSchema = computed(
  () => project.value?.compiledRoot.paramsSchema as JSONSchema7 | undefined,
)
const outputSchema = computed(
  () => project.value?.compiledRoot.outputSchema as JSONSchema7 | undefined,
)
const numericParameterPaths = computed(() => {
  const designSpace = project.value?.designSpace
  if (!designSpace || designSpace.schemaVersion !== 2)
    return collectNumericPaths(paramsSchema.value)
  return Object.entries(designSpace.inputs)
    .filter(
      ([, input]) =>
        input.role === 'design' &&
        (input.domain.kind === 'continuous' || input.domain.kind === 'integer'),
    )
    .map(([path]) => path)
})
const designInputSummary = computed(() => {
  const designSpace = project.value?.designSpace
  if (!designSpace || designSpace.schemaVersion !== 2) return []
  const labels: Record<DesignInputRole, string> = {
    design: 'design dimensions',
    requirement: 'requirements',
    scenario: 'scenario inputs',
    preference: 'preferences',
    uncertainty: 'uncertainties',
    fixed: 'fixed inputs',
  }
  const counts = Object.values(designSpace.inputs).reduce<Partial<Record<DesignInputRole, number>>>(
    (current, input) => ({ ...current, [input.role]: (current[input.role] ?? 0) + 1 }),
    {},
  )
  return Object.entries(counts).map(([role, count]) => ({
    role: role as DesignInputRole,
    label: labels[role as DesignInputRole],
    count,
  }))
})
const designInputCaption = computed(() =>
  designInputSummary.value.map(({ count, label }) => `${count} ${label}`).join(' · '),
)
const structuralAlternativeCount = computed(() => {
  const designSpace = project.value?.designSpace
  if (!designSpace || designSpace.schemaVersion !== 2) return 0
  return Object.values(designSpace.allowedAlternatives).reduce(
    (total, alternatives) => total + alternatives.length,
    0,
  )
})
const localSweepVariables = computed(() =>
  optimizationVariables.value.filter((path) =>
    allowedOptimizersByPath.value[path]?.includes('local-sweep'),
  ),
)
const optimizationCaption = computed(() => {
  const structural = structuralAlternativeCount.value
    ? ` · ${structuralAlternativeCount.value} structural alternatives`
    : ''
  return `${optimizationVariables.value.length} variables${structural} · maximize ${objectivePath.value}`
})
const studyRows = computed(() =>
  (studyResult.value?.rows ?? []).flatMap((value, index) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return []
    const recommendation = (value as { recommendation?: unknown }).recommendation
    if (!recommendation || typeof recommendation !== 'object' || Array.isArray(recommendation)) {
      return []
    }
    const candidate = recommendation as {
      id?: unknown
      configuration?: unknown
      viable?: unknown
      score?: unknown
      estimatedPriceUsd?: unknown
      usableVramGb?: unknown
      rejectedReasons?: unknown
    }
    if (
      typeof candidate.id !== 'string' ||
      typeof candidate.configuration !== 'string' ||
      typeof candidate.viable !== 'boolean' ||
      typeof candidate.score !== 'number' ||
      typeof candidate.estimatedPriceUsd !== 'number' ||
      typeof candidate.usableVramGb !== 'number'
    ) {
      return []
    }
    return [
      {
        index,
        id: candidate.id,
        name: candidate.configuration,
        viable: candidate.viable,
        score: candidate.score,
        price: candidate.estimatedPriceUsd,
        memory: candidate.usableVramGb,
        reasons: Array.isArray(candidate.rejectedReasons)
          ? candidate.rejectedReasons
              .filter((item): item is string => typeof item === 'string')
              .join(' ')
          : '',
        best: studyResult.value?.bestIndex === index,
      },
    ]
  }),
)

const shortHash = (hash: string) => `${hash.slice(0, 13)}…${hash.slice(-5)}`

function collectNumericPaths(schema: JSONSchema7 | undefined, prefix = ''): string[] {
  if (!schema || typeof schema !== 'object') return []
  return Object.entries(schema.properties ?? {}).flatMap(([name, definition]) => {
    if (typeof definition !== 'object' || definition === null) return []
    const path = prefix ? `${prefix}.${name}` : name
    if (definition.type === 'number' || definition.type === 'integer') return [path]
    return collectNumericPaths(definition, path)
  })
}

function valueAtPath(value: Record<string, unknown>, path: string): unknown {
  return path
    .split('.')
    .reduce<unknown>(
      (current, segment) =>
        typeof current === 'object' && current !== null
          ? (current as Record<string, unknown>)[segment]
          : undefined,
      value,
    )
}

function studyValues(value: number): number[] {
  const rounded = (candidate: number) =>
    Number.isInteger(value) ? Math.round(candidate) : Number(candidate.toPrecision(6))
  return [...new Set([rounded(value * 0.75), value, rounded(value * 1.25)])]
}

const activeStore = () => tystate.designProjectStore(projectId.value)

async function loadProject() {
  loading.value = true
  loadError.value = ''
  try {
    const store = activeStore()
    const bundledExample = bundledDesignExamples[projectId.value]
    if (projectId.value === 'ai-workstation' || bundledExample) {
      await ensureBundledDesignProject({
        projectId: projectId.value,
        store: store.objects,
        repository: store.repository,
        refName: selectedRef.value,
      })
    }
    const refs = await store.repository.listRefs()
    refOptions.value = Object.keys(refs)
    project.value = await loadDesignWorkspaceProject({
      store: store.objects,
      repository: store.repository,
      checkout: checkoutRevisionId.value
        ? { kind: 'revision', id: checkoutRevisionId.value }
        : { kind: 'ref', name: selectedRef.value },
      ...(selectedRoot.value ? { rootName: selectedRoot.value } : {}),
    })
    selectedRoot.value = project.value.rootName
    openedNodeViews.value = []
    nodeViewSequence = 0
    designDockLayout.value = initialDesignDockLayout()
    await tystate.registerDesignProject({
      projectId: projectId.value,
      title: projectTitle.value,
      refName: selectedRef.value,
    })
    const outputSchemaId = designOutputSchemaId(project.value)
    let visualization = await store.repository.getVisualization(
      project.value.rootName,
      outputSchemaId,
    )
    if (!visualization && projectId.value === 'ai-workstation') {
      const visualizationId = canonicalHash({
        schemaId: outputSchemaId,
        html: workstationVisualizationHtml,
      })
      await store.repository.putVisualization({
        rootName: project.value.rootName,
        outputSchemaId,
        visualizationId,
        html: workstationVisualizationHtml,
      })
      visualization = { visualizationId, html: workstationVisualizationHtml }
    } else if (!visualization && bundledExample) {
      const bundled = bundledVisualizationId(bundledExample, outputSchemaId)
      await store.repository.putVisualization({
        rootName: project.value.rootName,
        outputSchemaId,
        visualizationId: bundled.visualizationId,
        html: bundled.html,
      })
      visualization = bundled
    }
    visualizationHtml.value = visualization?.html ?? ''
    resultTab.value = visualization ? 'visualization' : 'result'
    params.value = defaultDesignParams(project.value)
    const designSpace = project.value.designSpace
    const allowedDesignVariables =
      designSpace.schemaVersion === 2
        ? Object.entries(designSpace.inputs)
            .filter(
              ([, input]) =>
                input.role === 'design' &&
                (input.domain.kind === 'continuous' || input.domain.kind === 'integer'),
            )
            .map(([path]) => path)
        : collectNumericPaths(project.value.compiledRoot.paramsSchema as JSONSchema7).slice(0, 2)
    optimizationVariables.value = allowedDesignVariables
    allowedOptimizersByPath.value = Object.fromEntries(
      allowedDesignVariables.map((path) => [path, [...defaultAllowedOptimizers]]),
    )
    optimizationMode.value = false
    const objective = designSpace.schemaVersion === 2 ? designSpace.objectives[0] : undefined
    objectivePath.value = objective?.path ?? 'recommendation.score'
    result.value = null
    evaluation.value = null
    studyResult.value = null
    void requestEvaluation()
  } catch (error) {
    loadError.value = error instanceof Error ? error.message : String(error)
  } finally {
    loading.value = false
  }
}

async function runStudy() {
  if (
    !project.value ||
    (localSweepVariables.value.length === 0 && structuralAlternativeCount.value === 0)
  ) {
    return
  }
  studying.value = true
  evaluationError.value = ''
  try {
    const variables = Object.fromEntries(
      localSweepVariables.value.map((path) => {
        const value = valueAtPath(params.value, path)
        if (typeof value !== 'number')
          throw new Error(`Optimization variable is not numeric: ${path}`)
        return [path, { kind: 'grid' as const, values: studyValues(value) }]
      }),
    )
    const completed = await evaluateDesignStudy({
      project: project.value,
      repository: activeStore().repository,
      storageBackend: tystate.dagStorageBackend,
      params: params.value,
      config: {
        mode: 'optimize',
        variables,
        objective: { path: objectivePath.value, direction: 'max' },
        budget: { maxEvals: 25 },
        rngSeed: 1,
      },
    })
    studyResult.value = completed.value
    resultTab.value = 'study'
  } catch (error) {
    evaluationError.value = error instanceof Error ? error.message : String(error)
  } finally {
    studying.value = false
  }
}

function selectRef(value: string | null) {
  if (!value || value === selectedRef.value) return
  selectedRef.value = value
  void router.replace({
    name: 'design-workspace',
    params: { projectId: projectId.value, refName: value },
    query: route.query,
  })
  void loadProject()
}

function selectRoot(value: string | null) {
  if (!value || value === selectedRoot.value) return
  selectedRoot.value = value
  void loadProject()
}

async function openDesignSearch() {
  designSearchOpen.value = true
  designSearchLoading.value = true
  designSearchError.value = ''
  try {
    localDesignProjects.value = await tystate.listDesignProjects()
  } catch (error) {
    designSearchError.value = error instanceof Error ? error.message : String(error)
  } finally {
    designSearchLoading.value = false
  }
}

async function openDesign(entry: DesignSearchEntry) {
  designSearchOpen.value = false
  selectedRef.value = entry.refName
  selectedRoot.value = ''
  await router.push({
    name: 'design-workspace',
    params: { projectId: entry.projectId, refName: entry.refName },
  })
  await loadProject()
}

function onParamsChanged(value: Record<string, unknown> | undefined) {
  params.value = value ?? {}
  if (autoEvaluate.value) scheduleEvaluation()
}

function onAutoEvaluateChanged(enabled: boolean) {
  if (enabled) scheduleEvaluation()
  else if (evaluationTimer) clearTimeout(evaluationTimer)
}

function scheduleEvaluation() {
  requestedVersion += 1
  if (evaluationTimer) clearTimeout(evaluationTimer)
  evaluationTimer = setTimeout(() => void requestEvaluation(), 500)
}

async function requestEvaluation() {
  if (!project.value) return
  requestedVersion += 1
  const version = requestedVersion
  if (evaluating.value) {
    queuedEvaluation = true
    return
  }
  evaluating.value = true
  evaluationError.value = ''
  try {
    const store = activeStore()
    const completed = await evaluateDesign({
      project: project.value,
      repository: store.repository,
      storageBackend: tystate.dagStorageBackend,
      params: params.value,
    })
    if (version === requestedVersion) {
      result.value = completed.value
      evaluation.value = completed.evaluation
      await nextTick()
      sendVisualizationResult()
    }
  } catch (error) {
    if (version === requestedVersion) {
      evaluationError.value = error instanceof Error ? error.message : String(error)
    }
  } finally {
    evaluating.value = false
    if (queuedEvaluation) {
      queuedEvaluation = false
      void requestEvaluation()
    }
  }
}

function resetParams() {
  if (!project.value) return
  params.value = defaultDesignParams(project.value)
  if (autoEvaluate.value) scheduleEvaluation()
}

async function saveDesign() {
  if (!evaluation.value || !designName.value.trim() || !project.value) return
  await activeStore().repository.saveDesign(
    project.value.rootName,
    designName.value.trim(),
    evaluation.value.id,
  )
  saveDialog.value = false
  designName.value = ''
}

const visualizationCsp =
  "default-src 'none'; img-src data: blob:; style-src 'unsafe-inline'; script-src 'unsafe-inline'; font-src data:;"
const sandboxedVisualization = computed(() => {
  if (!visualizationHtml.value) return ''
  const csp = `<meta http-equiv="Content-Security-Policy" content="${visualizationCsp}">`
  const bootstrap = `<script>${designRendererBootstrapSource}<` + '/script>'
  return visualizationHtml.value.includes('<head>')
    ? visualizationHtml.value.replace('<head>', `<head>${csp}${bootstrap}`)
    : `${csp}${bootstrap}${visualizationHtml.value}`
})

function sendVisualizationResult() {
  if (!visualizationConnection || result.value === null) return
  visualizationConnection.sendResult(result.value)
}

function connectVisualizationRenderer() {
  visualizationConnection?.destroy()
  visualizationConnection = null
  const frame = visualizationFrame.value
  if (!frame) return
  visualizationConnection = connectDesignRendererFrame(frame)
  sendVisualizationResult()
}

const chatTools = [
  createClientTool({
    name: 'designAssistant',
    description: 'Help the user inspect and evolve the active reproducible design.',
    parameters: { type: 'object', properties: {}, additionalProperties: false } as const,
    function: (_args, ctx) =>
      ctx.createSubtasksResult([
        createChatCompletionTask({
          appendSystemPrompts: [
            `You are collaborating inside Taskyon's design workspace.
The exact revision, root parameters, and latest result are available through inspectDesignWorkspace.
Use updateDesignParameters when the user asks to change the live design.
When a domain-specific visual would materially improve understanding, create one reusable HTML renderer with setDesignVisualization. Register its render function with connectDesignRenderer(render), which supplies each evaluated root result. Do not use window messaging or fetch network resources.`,
          ],
          allowedTools: [
            'inspectDesignWorkspace',
            'updateDesignParameters',
            'setDesignVisualization',
          ],
        }),
      ]),
  }),
  createClientTool({
    name: 'inspectDesignWorkspace',
    description: 'Inspect the exact active design revision, schemas, parameters, and result.',
    parameters: { type: 'object', properties: {}, additionalProperties: false } as const,
    function: () => ({
      projectId: projectId.value,
      revisionId: project.value?.revision.id,
      rootName: project.value?.rootName,
      paramsSchema: project.value?.compiledRoot.paramsSchema,
      outputSchema: project.value?.compiledRoot.outputSchema,
      params: params.value,
      result: result.value,
      optimization: {
        designSpace: project.value?.designSpace,
        variables: optimizationVariables.value,
        allowedOptimizersByPath: allowedOptimizersByPath.value,
        objectivePath: objectivePath.value,
        lastStudy: studyResult.value,
      },
    }),
  }),
  createClientTool({
    name: 'updateDesignParameters',
    description: 'Replace the transient parameter values for the selected design root.',
    parameters: {
      type: 'object',
      properties: { params: { type: 'object', additionalProperties: true } },
      required: ['params'],
      additionalProperties: false,
    } as const,
    function: ({ params: nextParams }) => {
      onParamsChanged(nextParams)
      return { updated: true, params: params.value }
    },
  }),
  createClientTool({
    name: 'setDesignVisualization',
    description: 'Install a sandboxed HTML renderer for the current root result shape.',
    parameters: {
      type: 'object',
      properties: { html: { type: 'string' } },
      required: ['html'],
      additionalProperties: false,
    } as const,
    function: async ({ html }) => {
      if (!project.value) throw new Error('No active design root.')
      if (html.length > 200_000) throw new Error('Visualization HTML exceeds 200 KB.')
      const schemaId = designOutputSchemaId(project.value)
      const visualizationId = canonicalHash({ schemaId, html })
      await activeStore().repository.putVisualization({
        rootName: project.value.rootName,
        outputSchemaId: schemaId,
        visualizationId,
        html,
      })
      visualizationHtml.value = html
      resultTab.value = 'visualization'
      return { visualizationId, outputSchemaId: schemaId }
    },
  }),
]

const chatConfiguration = computed<partialTyConfiguration | null>(() => {
  const key = tystate.getTaskyonKeyString()
  if (key == null) return null
  return {
    llmSettings: { entryFunction: 'designAssistant' },
    appConfiguration: {
      guiMode: 'minChat',
      expertMode: true,
      showLogo: false,
      chatSuggestions: [],
      welcomeMsg: designAssistantWelcome.value,
    },
    signatureOrKey: key,
  }
})

onMounted(loadProject)
onBeforeUnmount(() => {
  if (evaluationTimer) clearTimeout(evaluationTimer)
  visualizationConnection?.destroy()
  visualizationConnection = null
})
</script>

<style scoped>
.design-page {
  height: calc(100vh - 50px);
  min-height: 42rem;
  overflow: hidden;
}

.design-workspace {
  height: 100%;
  min-width: 0;
  background: var(--q-dark-page);
}

body:not(.body--dark) .design-workspace {
  background: #f6f8fb;
}

.design-toolbar {
  min-height: 3.25rem;
  gap: 0.35rem;
  padding: 0.35rem 0.55rem;
  border-bottom: 1px solid color-mix(in srgb, currentColor 14%, transparent);
}

.design-title {
  min-width: 7rem;
  max-width: 16rem;
  font-size: 1rem;
  font-weight: 600;
  letter-spacing: -0.01em;
}

.toolbar-select {
  width: 7.5rem;
}

.toolbar-select :deep(.q-field__control),
.toolbar-select :deep(.q-field__marginal) {
  height: 2.25rem;
  min-height: 2.25rem;
}

.design-content {
  min-height: 0;
  padding: 0.35rem;
  overflow: hidden;
}

.design-primary {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0.35rem;
  min-height: 0;
}

.workspace-pane {
  min-width: 0;
  min-height: 0;
  overflow: hidden;
  border-radius: 0.35rem;
}

.compact-panel-header {
  min-height: 2.6rem;
  gap: 0.28rem;
  padding: 0.25rem 0.45rem;
}

.panel-title {
  flex: 0 0 auto;
  font-size: 0.84rem;
  font-weight: 600;
}

.panel-summary {
  min-width: 0;
  margin-left: 0.35rem;
  color: var(--q-grey-6);
  font-size: 0.68rem;
}

.workspace-pane-scroll {
  height: calc(100% - 2.65rem);
}

.compact-object-view {
  padding: 0.35rem 0.45rem 1rem;
}

.optimization-mode-button--active {
  background: color-mix(in srgb, var(--q-secondary) 12%, transparent);
}

.optimization-mode-bar {
  display: grid;
  gap: 0.45rem;
  margin-bottom: 0.6rem;
  padding: 0.5rem;
  border: 1px solid color-mix(in srgb, var(--q-secondary) 24%, transparent);
  border-radius: 0.35rem;
  background: color-mix(in srgb, var(--q-secondary) 5%, transparent);
}

.optimization-mode-summary {
  display: flex;
  align-items: center;
  min-width: 0;
}

.optimization-hint {
  color: var(--q-grey-7);
  font-size: 0.68rem;
  line-height: 1.35;
}

.result-panels {
  height: calc(100% - 5rem);
}

.compact-result-tabs {
  min-height: 2.25rem;
}

.compact-result-tabs :deep(.q-tab) {
  min-height: 2.25rem;
  padding: 0 0.65rem;
  font-size: 0.72rem;
}

.compact-tab-panel {
  padding: 0.45rem;
}

.design-workspace-dock {
  height: 100%;
  min-height: 0;
  overflow: hidden;
  border: 1px solid color-mix(in srgb, currentColor 14%, transparent);
  border-radius: 0.35rem;
  background: color-mix(in srgb, currentColor 2%, transparent);
}

.design-workspace-dock :deep(.dock-tabs-header) {
  min-height: 2rem;
  background: color-mix(in srgb, currentColor 3%, transparent);
}

.design-workspace-dock :deep(.dock-tab) {
  max-width: 13rem;
  min-height: 2rem;
  padding: 0.2rem 0.65rem;
  font-size: 0.74rem;
}

.design-workspace-dock :deep(.dock-tab.active) {
  color: var(--q-secondary);
  background: color-mix(in srgb, var(--q-secondary) 8%, transparent);
}

.design-workspace-dock :deep(.dock-tab-minimize) {
  display: none;
}

.graph-pane {
  position: relative;
  min-width: 0;
  min-height: 0;
}

.graph-toolbar {
  flex: 0 0 auto;
  max-width: 100%;
  padding: 0.12rem;
  overflow-x: auto;
  border-bottom: 1px solid color-mix(in srgb, currentColor 12%, transparent);
}

.graph-toolbar :deep(.q-btn) {
  min-height: 1.8rem;
  padding: 0.2rem 0.32rem;
  font-size: 0.68rem;
}

.graph-toolbar :deep(.q-separator--vertical) {
  margin-right: 0.12rem;
  margin-left: 0.12rem;
}

.graph-canvas-host {
  min-height: 0;
  height: auto;
}

.graph-pane :deep(.design-graph-node-card) {
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  width: 100%;
  height: 100%;
  padding: 0.45rem 0.55rem;
  overflow: hidden;
  font-size: 0.7rem;
}

.graph-pane :deep(.design-graph-node-heading) {
  margin-bottom: 0.25rem;
  overflow: hidden;
  font-weight: 650;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.graph-pane :deep(.design-graph-record-kind) {
  color: color-mix(in srgb, currentColor 65%, transparent);
  font-size: 0.61rem;
  font-weight: 700;
  letter-spacing: 0.06em;
  text-transform: uppercase;
}

.graph-pane :deep(.design-graph-record-hash) {
  overflow: hidden;
  color: color-mix(in srgb, currentColor 72%, transparent);
  font-size: 0.64rem;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.graph-pane :deep(.design-graph-ports) {
  display: grid;
  gap: 0.12rem;
  min-height: 0;
}

.graph-pane :deep(.design-graph-port) {
  display: grid;
  grid-template-columns: minmax(4.5rem, auto) minmax(0, 1fr);
  gap: 0.4rem;
  align-items: center;
  min-width: 0;
}

.graph-pane :deep(.design-graph-port--output) {
  margin-top: 0.12rem;
  padding-top: 0.18rem;
  border-top: 1px solid color-mix(in srgb, currentColor 14%, transparent);
  color: var(--q-secondary);
}

.graph-pane :deep(.design-graph-port-name) {
  font-weight: 600;
}

.graph-pane :deep(.design-graph-port-type) {
  overflow: hidden;
  color: color-mix(in srgb, currentColor 70%, transparent);
  font-family: monospace;
  font-size: 0.64rem;
  text-align: right;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.graph-identity {
  position: absolute;
  bottom: 0.5rem;
  left: 0.5rem;
  z-index: 2;
  display: grid;
  grid-template-columns: auto minmax(8rem, 1fr);
  gap: 0.15rem 0.55rem;
  width: min(20rem, calc(100% - 1rem));
  padding: 0.35rem 0.45rem;
  border: 1px solid color-mix(in srgb, currentColor 14%, transparent);
  border-radius: 0.35rem;
  background: color-mix(in srgb, var(--q-dark-page) 90%, transparent);
  font-size: 0.68rem;
}

body:not(.body--dark) .graph-identity {
  background: rgba(255, 255, 255, 0.92);
}

.graph-identity span {
  color: var(--q-grey-6);
}

.graph-identity code {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.structural-banner {
  color: inherit;
  background: color-mix(in srgb, var(--q-secondary) 10%, transparent);
}

.empty-result {
  min-height: 12rem;
  gap: 0.75rem;
}

.visualization-frame {
  width: 100%;
  height: 100%;
  min-height: 100%;
  border: 0;
  background: white;
}

.hash-value {
  overflow-wrap: anywhere;
  font-family: monospace;
  font-size: 0.76rem;
}

.design-search-card {
  width: min(92vw, 38rem);
  max-width: 38rem;
}

.design-search-results {
  max-height: min(55vh, 28rem);
  overflow-y: auto;
}

.study-row--best {
  background: color-mix(in srgb, var(--q-positive) 12%, transparent);
}

.study-reasons {
  max-width: 24rem;
  white-space: normal;
}

@media (max-width: 900px) {
  .design-page {
    height: auto;
    min-height: 100vh;
    overflow: visible;
  }

  .design-content {
    overflow: hidden;
  }

  .design-primary {
    display: flex;
    flex-direction: column;
    overflow-y: auto;
  }

  .workspace-pane {
    flex: 0 0 32rem;
  }

  .design-toolbar {
    flex-wrap: wrap;
  }
}
</style>
