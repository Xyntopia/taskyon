<!-- ObjectView.vue -->
<template>
  <div v-if="modelValue">
    <div v-if="enableExpertMode" class="row">
      <SearchInput
        :search-string="searchText"
        class="col fit"
        outlined
        dense
        hide-number-of-search-results
        :show-filter-button="false"
        color="secondary"
        @search="(q, k) => (searchText = q)"
      />
      <q-btn
        class="col-auto"
        flat
        stretch
        :icon="viewMode === 'tree' ? matList : mdiFileTree"
        @click="() => (viewMode = viewMode === 'tree' ? 'flat' : 'tree')"
      >
        <q-tooltip>Toggle View Mode (hierarchical/flat list)</q-tooltip>
      </q-btn>
      <q-select v-model="missingMode" :options="['all', 'hide', 'placeholders']" dense outlined />
    </div>
    <TreeVariablesView
      v-if="viewMode === 'tree'"
      :nodes="filteredTreeNodes"
      :load-children="buildChildrenForPath"
      :read-only="readOnly"
      :separate-labels="separateLabels"
      :debounce="debounce"
      :copy-btn="copyBtn"
      :input-field-behavior="inputFieldBehavior"
      :list-summary="listSummary"
      :chart-paths="chartPaths"
      :full-view-paths="fullViewPaths"
      :renderers="renderers"
      :show-missing-indicator="showMissingIndicator"
      v-bind="$attrs"
      @update="({ path, value }) => updateByPath(path, value)"
      @reset="(node) => resetNode(node)"
      @copy="(path) => copyNodeValue(path)"
      @toggle-chart="(id) => toggleChartPath(id)"
      @toggle-full-view="({ id, value }) => toggleFullView(id, value)"
    >
      <template #header-extra="slotProps">
        <slot name="header-extra" v-bind="slotProps" />
      </template>
      <template #custom="slotProps">
        <slot name="custom" v-bind="slotProps" />
      </template>
    </TreeVariablesView>

    <FlatVariablesView
      v-else
      :nodes="filteredFlatNodes"
      :read-only="readOnly"
      :separate-labels="separateLabels"
      :debounce="debounce"
      :copy-btn="copyBtn"
      :input-field-behavior="inputFieldBehavior"
      :list-summary="listSummary"
      :chart-paths="chartPaths"
      :full-view-paths="fullViewPaths"
      :renderers="renderers"
      :show-missing-indicator="showMissingIndicator"
      v-bind="$attrs"
      @update="({ path, value }) => updateByPath(path, value)"
      @reset="(node) => resetNode(node)"
      @copy="(path) => copyNodeValue(path)"
      @toggle-chart="(id) => toggleChartPath(id)"
      @toggle-full-view="({ id, value }) => toggleFullView(id, value)"
    >
      <template #header-extra="slotProps">
        <slot name="header-extra" v-bind="slotProps" />
      </template>
      <template #custom="slotProps">
        <slot name="custom" v-bind="slotProps" />
      </template>
    </FlatVariablesView>
  </div>

  <div v-else>no input data!</div>
</template>

<script setup lang="ts">
import { matList } from '@quasar/extras/material-icons'
import { mdiFileTree } from '@quasar/extras/mdi-v6'
import { type JSONSchema7 } from 'json-schema'
import { copyToClipboard, countLeaves } from 'src/modules/utils'
import { computed, ref, toRef } from 'vue'
import type z from 'zod'
import SearchInput from '../SearchInput.vue'
import FlatVariablesView from './FlatVariablesView.vue'
import TreeVariablesView from './TreeVariablesView.vue'
import type { VariableNode } from './useVariableGraph'
import {
  filterFlat,
  filterVariableTree,
  flattenVariables,
  useVariableGraph,
} from './useVariableGraph'
import type { CustomRenderer } from './VariableField.vue'

export type iconMap = {
  [key: string]: string | iconMap
}

const viewMode = defineModel<'tree' | 'flat'>('viewMode', {
  default: 'tree',
})

const missingMode = defineModel<'hide' | 'placeholders' | 'all'>('missingMode', {
  default: 'all',
})

const {
  readOnly = false,
  inputFieldBehavior = 'auto',
  separateLabels = true,
  debounce = 100,
  schema = undefined,
  descriptionsAsLabels = false,
  showMissingIndicator = true,
  copyBtn = false,
  lazyRender = false,
  listSummary = 10,
  icons = {},
  search = undefined,
  renderers = [],
  enableExpertMode = false,
} = defineProps<{
  readOnly?: boolean
  inputFieldBehavior?: 'auto' | 'textarea' | 'autogrow'
  separateLabels?: boolean
  debounce?: number
  schema?: JSONSchema7 | z.core.JSONSchema.BaseSchema | undefined
  descriptionsAsLabels?: boolean
  showMissingIndicator?: boolean
  copyBtn?: boolean
  lazyRender?: boolean
  listSummary?: number
  icons?: iconMap
  search?: string
  renderers?: CustomRenderer[]
  enableExpertMode?: boolean
}>()

const modelValue = defineModel<Record<string, unknown> | undefined>({ required: true })

const chartPaths = defineModel<string[]>('chartPaths', {
  default: () => [],
})

const schemaRef = toRef(() => schema)

const searchText = ref(search ?? '')
const effectiveLazy = computed(() => lazyRender && searchText.value.length === 0)

const optionsRef = computed(() => ({
  missingMode: missingMode.value,
  showMissingIndicator,
  descriptionsAsLabels,
  inputFieldBehavior,
  lazyRender: effectiveLazy.value,
  icons,
}))

const { rootNodes, buildChildrenForPath, getValueByPath } = useVariableGraph(
  modelValue,
  schemaRef,
  optionsRef,
)

const filteredTreeNodes = computed(() =>
  searchText.value ? filterVariableTree(rootNodes.value, searchText.value) : rootNodes.value,
)

const flatNodes = computed(() => flattenVariables(rootNodes.value, true))

const filteredFlatNodes = computed(() =>
  searchText.value ? filterFlat(flatNodes.value, searchText.value) : flatNodes.value,
)

const updateByPath = (keyPath: string[], value: unknown) => {
  console.log('updating path', keyPath, 'to value', value)
  if (!modelValue.value) return

  let target: Record<string, unknown> = modelValue.value
  for (let i = 0; i < keyPath.length - 1; i++) {
    const segment = keyPath[i]!
    const cur = target[segment]
    if (cur == null || typeof cur !== 'object' || Array.isArray(cur)) {
      target[segment] = {}
    }
    target = target[segment] as Record<string, unknown>
  }
  target[keyPath[keyPath.length - 1]!] = value
}

const resetNode = (node: VariableNode) => {
  if (node.default !== undefined) {
    updateByPath(node.path, node.default)
  }
}

const copyNodeValue = (path: string[]) => {
  if (!modelValue.value) return
  const value = getValueByPath(modelValue.value, path)
  void copyToClipboard(JSON.stringify(value, null, 2))
}

const toggleChartPath = (id: string) => {
  const current = chartPaths.value ?? []
  const idx = current.indexOf(id)
  chartPaths.value = idx === -1 ? [...current, id] : current.filter((p) => p !== id)
}

const fullViewPaths = ref<string[]>([])

const toggleFullView = (id: string, value: unknown) => {
  if (fullViewPaths.value.includes(id)) {
    fullViewPaths.value = fullViewPaths.value.filter((k) => k !== id)
    return
  }
  const leaves = countLeaves(value)
  if (leaves > 5000) {
    const confirmLoad = window.confirm(
      `This object contains approx ${leaves} items. Rendering the full editor might freeze your browser. Are you sure?`,
    )
    if (!confirmLoad) return
  }
  fullViewPaths.value = [...fullViewPaths.value, id]
}
</script>
