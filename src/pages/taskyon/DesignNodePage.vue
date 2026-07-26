<template>
  <q-page class="design-node-page column no-wrap">
    <header class="design-node-toolbar row items-center no-wrap">
      <q-btn
        flat
        round
        dense
        :icon="matArrowBack"
        :to="workspaceRoute"
        aria-label="Back to design workspace"
      />
      <div class="text-subtitle1">Design graph node</div>
      <q-space />
      <code>{{ rootName }}</code>
    </header>

    <div v-if="loading" class="col flex flex-center">
      <q-spinner-orbit color="secondary" size="3rem" />
    </div>
    <q-banner v-else-if="loadError" class="bg-negative text-white q-ma-md" rounded>
      {{ loadError }}
      <template #action>
        <q-btn flat label="Retry" @click="loadNode" />
      </template>
    </q-banner>
    <DagNodeViewer
      v-else-if="viewer"
      :model-value="viewer.source"
      :label="viewer.label"
      :path="viewer.path"
      :local-name="viewer.localName"
      :hash="viewer.hash"
      :input-schema="viewer.inputSchema"
      :output-schema="viewer.outputSchema"
      :upstream-nodes="upstreamNodes"
      :downstream-nodes="downstreamNodes"
      show-navigation
      class="col"
      @select-node="selectNode"
    />
  </q-page>
</template>

<script setup lang="ts">
import { matArrowBack } from '@quasar/extras/material-icons'
import type { Hash } from '@taskyon/comp-dag/caching'
import DagNodeViewer from '@taskyon/ui/components/DagNodeViewer.vue'
import { bundledDesignExamples } from 'src/modules/bundledDesignExamples'
import {
  ensureBundledDesignProject,
  designNodeViewerData,
  loadDesignWorkspaceProject,
  type DesignNodeViewerData,
} from 'src/modules/designWorkspaceRuntime'
import { useTaskyonStore } from 'src/stores/taskyonState'
import { computed, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'

const route = useRoute()
const router = useRouter()
const tystate = useTaskyonStore()
const projectId = computed(() => String(route.params.projectId))
const refName = computed(() => String(route.params.refName || 'main'))
const revisionId = computed(() =>
  route.params.revisionId ? (String(route.params.revisionId) as Hash) : null,
)
const rootName = computed(() => String(route.params.rootName))
const nodeHash = computed(() => String(route.params.nodeHash))
const viewer = ref<DesignNodeViewerData | null>(null)
const loading = ref(true)
const loadError = ref('')
const workspaceRoute = computed(() =>
  revisionId.value
    ? {
        name: 'design-workspace-revision',
        params: { projectId: projectId.value, revisionId: revisionId.value },
      }
    : {
        name: 'design-workspace',
        params: { projectId: projectId.value, refName: refName.value },
      },
)
const nodeRoute = (hash: Hash) => ({
  name: revisionId.value ? 'design-node-revision' : 'design-node',
  params: {
    projectId: projectId.value,
    ...(revisionId.value ? { revisionId: revisionId.value } : { refName: refName.value }),
    rootName: rootName.value,
    nodeHash: hash,
  },
})
const navigationItem = (item: DesignNodeViewerData['upstream'][number]) => ({
  id: item.hash,
  label: item.label,
  caption: item.localName,
})
const upstreamNodes = computed(() => viewer.value?.upstream.map(navigationItem) ?? [])
const downstreamNodes = computed(() => viewer.value?.downstream.map(navigationItem) ?? [])
const selectNode = (hash: string) => router.push(nodeRoute(hash as Hash))

async function loadNode() {
  loading.value = true
  loadError.value = ''
  try {
    const store = tystate.designProjectStore(projectId.value)
    if (projectId.value === 'ai-workstation' || bundledDesignExamples[projectId.value]) {
      await ensureBundledDesignProject({
        projectId: projectId.value,
        store: store.objects,
        repository: store.repository,
        refName: refName.value,
      })
    }
    const project = await loadDesignWorkspaceProject({
      store: store.objects,
      repository: store.repository,
      checkout: revisionId.value
        ? { kind: 'revision', id: revisionId.value }
        : { kind: 'ref', name: refName.value },
      rootName: rootName.value,
    })
    const selectedHash = nodeHash.value as Hash
    if (!project.graph[selectedHash]) {
      throw new Error(`Design graph node not found: ${nodeHash.value}`)
    }
    viewer.value = designNodeViewerData(project, selectedHash)
  } catch (error) {
    viewer.value = null
    loadError.value = error instanceof Error ? error.message : String(error)
  } finally {
    loading.value = false
  }
}

watch(
  [projectId, refName, revisionId, rootName, nodeHash],
  () => {
    void loadNode()
  },
  { immediate: true },
)
</script>

<style scoped>
.design-node-page {
  height: 100vh;
  min-height: 30rem;
  overflow: hidden;
}

.design-node-toolbar {
  flex: 0 0 auto;
  min-height: 3rem;
  gap: 0.4rem;
  padding: 0.35rem 0.6rem;
  border-bottom: 1px solid color-mix(in srgb, currentColor 12%, transparent);
}
</style>
