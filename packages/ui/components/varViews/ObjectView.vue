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
        @search="updateSearchText"
      />

      <q-btn
        v-if="copyObjectBtn"
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
      :default-expanded-depth="defaultExpandedDepth"
      :schema-documentation="schemaDocumentation"
      v-bind="$attrs"
      @update="({ path, value }) => updateByPath(path, value)"
      @reset="(node) => resetNode(node)"
      @copy="(path) => copyNodeValue(path)"
      @toggle-chart="(id) => toggleChartPath(id)"
      @toggle-full-view="({ id, value }) => toggleFullView(id, value)"
    >
      <template #header-extra="slotProps">
        <q-btn
          v-if="shouldShowAddKey(slotProps.node)"
          flat
          dense
          size="sm"
          :icon="matAdd"
          @click.stop="addObjectKeyAtNode(slotProps.node)"
        >
          <q-tooltip>Add key</q-tooltip>
        </q-btn>
        <q-btn
          v-if="shouldShowDeleteKey(slotProps.node)"
          flat
          dense
          size="sm"
          :icon="matDelete"
          color="negative"
          @click.stop="deleteNodeAtPath(slotProps.node)"
        >
          <q-tooltip>Delete key</q-tooltip>
        </q-btn>
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
        <q-btn
          v-if="shouldShowAddKey(slotProps.node)"
          flat
          dense
          size="sm"
          :icon="matAdd"
          @click.stop="addObjectKeyAtNode(slotProps.node)"
        >
          <q-tooltip>Add key</q-tooltip>
        </q-btn>
        <q-btn
          v-if="shouldShowDeleteKey(slotProps.node)"
          flat
          dense
          size="sm"
          :icon="matDelete"
          color="negative"
          @click.stop="deleteNodeAtPath(slotProps.node)"
        >
          <q-tooltip>Delete key</q-tooltip>
        </q-btn>
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
import { copyToClipboard, countLeaves } from '@taskyon/common/modules/utils'
import { computed, ref, toRaw, toRef } from 'vue'
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
import { safeYamlDump } from '@taskyon/common/modules/yamlUtils'
import { matAdd, matContentCopy, matDelete } from '@quasar/extras/material-icons'

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
  allowObjectStructureEditing = false,
  defaultExpandedDepth = 0,
  schemaDocumentation = false,
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

  /**
   * Enables editing object structure in tree/flat views (add/delete keys).
   */
  allowObjectStructureEditing?: boolean

  /** Number of object levels expanded when the tree view is first rendered. */
  defaultExpandedDepth?: number

  /** Renders schema types and expandable array item schemas for documentation. */
  schemaDocumentation?: boolean
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

const updateSearchText = (query: string) => {
  searchText.value = query
}

const optionsRef = computed(() => ({
  missingMode: missingMode.value,
  showMissingIndicator,
  descriptionsAsLabels,
  inputFieldBehavior,
  lazyRender: effectiveLazy.value,
  icons,
  schemaDocumentation,
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

const logObjectEdit = (action: string, payload: Record<string, unknown>) => {
  console.debug('[ObjectView]', action, payload)
}

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

function cloneModelRoot(): Record<string, unknown> | undefined {
  if (!modelValue.value) return undefined
  try {
    // `modelValue` can be a Vue reactive proxy, which may throw DataCloneError with structuredClone.
    // JSON clone is sufficient for our schema-edited library metadata objects.
    return JSON.parse(JSON.stringify(toRaw(modelValue.value))) as Record<string, unknown>
  } catch (error) {
    console.error('[ObjectView] cloneModelRoot failed', error)
    return undefined
  }
}

const updateByPath = (keyPath: string[], value: unknown) => {
  const nextRoot = cloneModelRoot()
  if (!nextRoot) return

  let target: Record<string, unknown> = nextRoot
  for (let i = 0; i < keyPath.length - 1; i++) {
    const segment = keyPath[i]!
    const cur = target[segment]
    if (cur == null || typeof cur !== 'object' || Array.isArray(cur)) {
      target[segment] = {}
    }
    target = target[segment] as Record<string, unknown>
  }
  target[keyPath[keyPath.length - 1]!] = value
  logObjectEdit('updateByPath', {
    path: keyPath.join('.'),
    value,
  })
  modelValue.value = nextRoot
}

function resolveJsonSchemaDefinition(
  definition: unknown,
): JSONSchema7 | z.core.JSONSchema.BaseSchema | undefined {
  if (!definition || typeof definition !== 'object') return undefined
  if (typeof definition === 'boolean') return undefined
  return definition as JSONSchema7 | z.core.JSONSchema.BaseSchema
}

function defaultValueFromSchema(
  schemaNode: JSONSchema7 | z.core.JSONSchema.BaseSchema | undefined,
): unknown {
  if (!schemaNode || typeof schemaNode !== 'object') return {}
  const record = schemaNode as Record<string, unknown>
  if (Object.prototype.hasOwnProperty.call(record, 'default')) return record.default

  const unionDefs = [
    ...(Array.isArray(record.oneOf) ? record.oneOf : []),
    ...(Array.isArray(record.anyOf) ? record.anyOf : []),
  ].filter((entry) => entry && typeof entry === 'object') as Array<Record<string, unknown>>
  if (unionDefs.length) {
    // For structural add-key scaffolding, prefer object branches so required child keys
    // (for example min/max) appear as schema-driven missing placeholders immediately.
    const preferredTypeOrder = ['object', 'array', 'number', 'integer', 'string', 'boolean']
    const selectedSchema =
      preferredTypeOrder
        .map((expectedType) =>
          unionDefs.find((entry) => {
            const entryType = Array.isArray(entry.type) ? entry.type[0] : entry.type
            return entryType === expectedType
          }),
        )
        .find(Boolean) ?? unionDefs[0]
    return defaultValueFromSchema(selectedSchema as JSONSchema7)
  }

  const schemaType = Array.isArray(record.type) ? record.type[0] : record.type
  if (schemaType === 'object') {
    const properties =
      record.properties && typeof record.properties === 'object'
        ? (record.properties as Record<string, unknown>)
        : undefined
    const requiredKeys = Array.isArray(record.required)
      ? record.required
          .map((entry) => (typeof entry === 'string' ? entry.trim() : ''))
          .filter((entry) => entry.length > 0)
      : []

    if (!requiredKeys.length || !properties) return {}

    const scaffold: Record<string, unknown> = {}
    for (const key of requiredKeys) {
      const propertySchema = resolveJsonSchemaDefinition(properties[key])
      const propertyRecord =
        propertySchema && typeof propertySchema === 'object'
          ? (propertySchema as Record<string, unknown>)
          : undefined
      if (propertyRecord && Object.prototype.hasOwnProperty.call(propertyRecord, 'default')) {
        scaffold[key] = propertyRecord.default
        continue
      }
      scaffold[key] = null
    }
    return scaffold
  }
  if (schemaType === 'array') return []
  if (schemaType === 'string') return ''
  if (schemaType === 'number' || schemaType === 'integer') return 0
  if (schemaType === 'boolean') return false
  return {}
}

const addObjectKeyAtNode = (node: VariableNode) => {
  if (readOnly || !allowObjectStructureEditing || !modelValue.value) return
  if (node.kind !== 'object') return

  const nextRoot = cloneModelRoot()
  if (!nextRoot) return
  const targetValue = getValueByPath(nextRoot, node.path)
  if (!targetValue || typeof targetValue !== 'object' || Array.isArray(targetValue)) return
  const targetObject = targetValue as Record<string, unknown>

  const rawKey = window.prompt(`Add key to "${node.label}"`, '')
  const key = `${rawKey ?? ''}`.trim()
  if (!key) return
  if (Object.prototype.hasOwnProperty.call(targetObject, key)) {
    window.alert(`Key "${key}" already exists.`)
    return
  }

  const nodeSchema = node.schema as JSONSchema7 | undefined
  const properties =
    nodeSchema && typeof nodeSchema === 'object' && nodeSchema.properties
      ? (nodeSchema.properties as Record<string, unknown>)
      : undefined
  const propertySchema = resolveJsonSchemaDefinition(properties?.[key])
  const additionalPropertiesSchema = resolveJsonSchemaDefinition(
    nodeSchema && typeof nodeSchema === 'object'
      ? (nodeSchema as Record<string, unknown>).additionalProperties
      : undefined,
  )
  const valueSchema = propertySchema ?? additionalPropertiesSchema
  const nextValue = defaultValueFromSchema(valueSchema)
  targetObject[key] = nextValue
  logObjectEdit('addObjectKeyAtNode', {
    path: [...node.path, key].join('.'),
    initializedWith: nextValue,
  })
  modelValue.value = nextRoot
}

const shouldShowAddKey = (node: VariableNode | undefined) => {
  if (!allowObjectStructureEditing || readOnly) return false
  if (!node || node.kind !== 'object') return false
  const hasMissingChild = (node.children ?? []).some((child) => child.missing)
  return !hasMissingChild
}

const deleteNodeAtPath = (node: VariableNode) => {
  if (readOnly || !allowObjectStructureEditing || !modelValue.value) return
  const path = node.path ?? []
  if (!path.length) return

  const nextRoot = cloneModelRoot()
  if (!nextRoot) return

  const parentPath = path.slice(0, -1)
  const leafKey = path[path.length - 1]!
  const parent = parentPath.length ? getValueByPath(nextRoot, parentPath) : nextRoot

  if (!parent || typeof parent !== 'object') return
  if (Array.isArray(parent)) {
    const index = Number(leafKey)
    if (!Number.isFinite(index) || index < 0 || index >= parent.length) return
    parent.splice(index, 1)
    logObjectEdit('deleteNodeAtPath', {
      path: path.join('.'),
    })
    modelValue.value = nextRoot
    return
  }
  delete (parent as Record<string, unknown>)[leafKey]
  logObjectEdit('deleteNodeAtPath', {
    path: path.join('.'),
  })
  modelValue.value = nextRoot
}

const shouldShowDeleteKey = (node: VariableNode | undefined) => {
  if (!allowObjectStructureEditing || readOnly) return false
  if (!node) return false
  return node.path.length > 0 && !node.missing
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
