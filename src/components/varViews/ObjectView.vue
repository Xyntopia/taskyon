<!-- ObjectView.vue -->
<template>
  <div v-if="modelValue">
    <div v-if="showHeaderRow" class="row items-center">
      <SearchInput
        v-if="enableExpertMode"
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
        v-if="copyObjectBtn && enableExpertMode"
        class="col-auto"
        flat
        stretch
        :icon="matContentCopy"
        @click="copyWholeObject"
      >
        <q-tooltip>Copy entire object as JSON</q-tooltip>
      </q-btn>

      <q-btn
        v-if="enableExpertMode"
        class="col-auto"
        flat
        stretch
        :label="viewMode.toUpperCase()"
        @click="cycleViewMode"
      >
        <q-tooltip>tree → flat → json → yaml</q-tooltip>
      </q-btn>

      <q-select
        v-if="showMissingModeSelect && enableExpertMode"
        v-model="missingMode"
        :options="['all', 'hide', 'placeholders']"
        dense
        outlined
        class="col-auto"
      />
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
      v-else-if="viewMode === 'flat'"
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

    <q-card v-else-if="viewMode === 'json'" flat bordered>
      <q-card-section class="q-pa-sm">
        <pre class="raw-view">{{ jsonDump }}</pre>
      </q-card-section>
    </q-card>

    <q-card v-else-if="viewMode === 'yaml'" flat bordered>
      <q-card-section class="q-pa-sm">
        <pre class="raw-view">{{ yamlDump }}</pre>
      </q-card-section>
    </q-card>
  </div>

  <div v-else>no input data!</div>
</template>

<script setup lang="ts">
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
import { safeYamlDump } from '../../../packages/taskyon/src/utils/yamlUtils'
import { matContentCopy } from '@quasar/extras/material-icons'

export type iconMap = {
  [key: string]: string | iconMap
}

const viewMode = defineModel<'tree' | 'flat' | 'json' | 'yaml'>('viewMode', {
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
  showMissingModeSelect = false,
  copyObjectBtn = false,
  copyObjectWarnLeavesLimit = 5000,
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

  /**
   * By default, ObjectView does not show a missing-mode selector.
   * This keeps the UI stable for normal users and avoids accidental changes.
   */
  showMissingModeSelect?: boolean

  /**
   * Shows a header button to copy the entire current modelValue as JSON.
   */
  copyObjectBtn?: boolean

  /**
   * If the object is large (approx leaf count above this), ask for confirmation before copying.
   */
  copyObjectWarnLeavesLimit?: number
}>()

const modelValue = defineModel<Record<string, unknown> | undefined>({ required: true })

const cycleViewMode = () => {
  const order: (typeof viewMode.value)[] = ['tree', 'flat', 'json', 'yaml']
  const i = order.indexOf(viewMode.value)
  viewMode.value = order[(i + 1) % order.length] ?? 'tree'
}

const jsonDump = computed(() => (modelValue.value ? JSON.stringify(modelValue.value, null, 2) : ''))

const yamlDump = computed(() => (modelValue.value ? safeYamlDump(modelValue.value) : ''))

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

const showHeaderRow = computed(() => enableExpertMode || copyObjectBtn || showMissingModeSelect)

const copyWholeObject = () => {
  if (!modelValue.value) return

  const leaves = countLeaves(modelValue.value)
  if (leaves > copyObjectWarnLeavesLimit) {
    const ok = window.confirm(
      `This object contains approx ${leaves} items. Copying may freeze your browser. Continue?`,
    )
    if (!ok) return
  }

  void copyToClipboard(JSON.stringify(modelValue.value, null, 2))
}

const updateByPath = (keyPath: string[], value: unknown) => {
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

<style lang="scss" scoped>
.raw-view {
  font-family: monospace;
  font-size: 12px;
  white-space: pre;
  overflow: auto;
  max-height: 70vh;
}
</style>
