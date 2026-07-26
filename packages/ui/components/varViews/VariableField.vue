<!-- VariableField.vue-->
<template>
  <FieldView
    :item="fieldItem"
    :show-label="showLabel"
    :reset="!node.missing && node.default !== undefined"
    :copy="copyBtn && !node.missing"
    :description-inline="schemaDocumentation"
    @reset="emit('reset')"
    @copy="emit('copy')"
  >
    <template #header-extra>
      <q-badge v-if="schemaDocumentation" color="grey-7" outline>{{ schemaType }}</q-badge>
      <q-badge v-if="showMissingIndicator && node.missing" color="grey" outline>missing</q-badge>
      <slot name="header-extra" :node="node" />
    </template>

    <slot name="custom" :node="node" :value="node.value" :update="emitUpdate">
      <component
        :is="customComponent"
        v-if="customComponent"
        v-bind="customComponentProps"
        :node="node"
        :value="node.value"
        :read-only="readOnly"
        @update="emitUpdate"
      />
      <template v-else>
        <template v-if="schemaDocumentation">
          <div />
        </template>
        <!-- missing placeholder -->
        <template v-else-if="node.missing && !readOnly">
          <q-btn
            flat
            dense
            size="sm"
            no-caps
            :label="'+ ' + node.label"
            @click.stop="enableField"
          />
          <span
            v-if="node.schema && 'default' in node.schema && node.schema.default !== undefined"
            class="text-caption text-grey-7 q-ml-sm"
          >
            Default: {{ String(node.schema.default) }}
          </span>
        </template>
        <template v-else>
          <!-- object: header only -->
          <template v-if="node.kind === 'object' || (node.kind === 'array' && node.children)">
            <div />
          </template>

          <!-- unknown -->
          <template v-else-if="node.kind === 'unknown'">
            <InfoDialog label="This field can’t be changed right now.">
              {{ node.value }}
            </InfoDialog>
          </template>

          <!-- text -->
          <template v-else-if="node.kind === 'text'">
            <q-input
              :readonly="readOnly"
              filled
              type="textarea"
              input-style="max-height: 300px"
              :label="showLabel ? '' : node.label"
              :debounce="debounce"
              :model-value="node.value as string"
              @update:model-value="emitUpdate"
            />
          </template>

          <!-- string -->
          <template v-else-if="node.kind === 'string'">
            <q-input
              :readonly="readOnly"
              filled
              dense
              :autogrow="inputFieldBehavior === 'autogrow'"
              :label="showLabel ? '' : node.label"
              :debounce="debounce"
              :model-value="node.value as string"
              @update:model-value="emitUpdate"
            />
          </template>

          <!-- boolean -->
          <template v-else-if="node.kind === 'boolean'">
            <q-chip
              v-if="readOnly"
              :icon="node.value ? node.onIcon : node.offIcon"
              :color="node.value ? 'positive' : 'negative'"
              text-color="white"
              :label="node.value ? 'Yes' : 'No'"
            />
            <q-toggle
              v-else
              dense
              size="lg"
              left-label
              :label="showLabel ? '' : node.label"
              :checked-icon="node.onIcon"
              :unchecked-icon="node.offIcon"
              color="secondary"
              :model-value="node.value"
              @update:model-value="emitUpdate"
            />
          </template>

          <!-- number -->
          <template v-else-if="node.kind === 'number'">
            <q-input
              :readonly="readOnly"
              filled
              dense
              type="number"
              :label="showLabel ? '' : node.label"
              :debounce="debounce"
              :model-value="node.value as number"
              @update:model-value="(v) => emitUpdate(Number(v))"
            />
          </template>

          <!-- enum -->
          <template v-else-if="node.kind === 'enum'">
            <q-select
              :disable="readOnly"
              filled
              dense
              emit-value
              :label="showLabel ? '' : node.label"
              :options="(node.options ?? []).map((v) => ({ label: String(v), value: v }))"
              :model-value="node.value"
              @update:model-value="emitUpdate"
            />
          </template>

          <!-- color -->
          <template v-else-if="node.kind === 'color'">
            <q-input
              filled
              dense
              :disable="readOnly"
              hide-bottom-space
              hide-hint
              :model-value="node.value as string"
              :rules="['anyColor']"
              style="max-width: 100px"
              @update:model-value="emitUpdate"
            >
              <template #append>
                <div
                  class="cursor-pointer"
                  :style="{
                    width: '0.8em',
                    height: '0.8em',
                    borderRadius: '50%',
                    background: String(node.value || '#000'),
                  }"
                >
                  <q-popup-proxy cover transition-show="scale" transition-hide="scale">
                    <q-color
                      :disable="readOnly"
                      :model-value="node.value as string"
                      @update:model-value="emitUpdate"
                    />
                  </q-popup-proxy>
                </div>
              </template>
            </q-input>
          </template>

          <!-- timestamp -->
          <template v-else-if="node.kind === 'timestamp'">
            <div class="row q-col-gutter-sm">
              <q-input
                filled
                dense
                type="date"
                :model-value="formatDate(node.value as number)"
                @update:model-value="(val) => updateDateTime(val ? String(val) : null, null)"
              />
              <q-input
                filled
                dense
                type="time"
                :model-value="formatTime(node.value as number)"
                @update:model-value="(val) => updateDateTime(null, val ? String(val) : null)"
              />
            </div>
          </template>

          <!-- array -->
          <template v-else-if="node.kind === 'array'">
            <div class="column q-gutter-sm">
              <div class="row items-center q-gutter-xs">
                <q-btn
                  v-if="isNumericArray(node.value)"
                  flat
                  dense
                  size="sm"
                  :icon="matBarChart"
                  :color="chartEnabled ? 'primary' : 'grey'"
                  @click.stop="emit('toggle-chart', node.id)"
                >
                  <q-tooltip>
                    {{ chartEnabled ? 'Hide chart' : 'Show chart' }}
                  </q-tooltip>
                </q-btn>

                <div class="text-caption text-grey">
                  <template
                    v-if="
                      Array.isArray(node.value) &&
                      node.value.length > 0 &&
                      node.value.every((r) => Array.isArray(r))
                    "
                  >
                    <div>
                      2D array of length {{ countLeaves(node.value) }} [{{ node.value.length }},
                      {{ Math.max(...node.value.map((r) => (Array.isArray(r) ? r.length : 0))) }}
                      max]
                    </div>
                  </template>
                  <template v-else>
                    <div>
                      Array of length {{ Array.isArray(node.value) ? node.value.length : 0 }}
                    </div>
                  </template>
                </div>

                <q-space />

                <q-btn
                  v-if="isLarge(node.value)"
                  flat
                  dense
                  size="sm"
                  no-caps
                  :label="fullViewEnabled ? 'Show Summary' : 'Show Full JSON'"
                  color="primary"
                  @click.stop="emit('toggle-full-view', { id: node.id, value: node.value })"
                />
              </div>

              <div>
                <template v-if="isNumericArray(node.value) && chartEnabled">
                  <ListChart :value="node.value as unknown[]" :title="node.label" />
                </template>

                <template v-else-if="!isLarge(node.value) || fullViewEnabled">
                  <JsonInput
                    :readonly="readOnly"
                    auto-save
                    filled
                    :label="showLabel ? '' : node.label"
                    :model-value="node.value as Record<string, unknown>"
                    style="min-width: 200px"
                    @update:model-value="emitUpdate"
                  />
                </template>

                <template v-else>
                  <div
                    class="q-pa-xs text-code text-caption"
                    style="
                      white-space: pre-wrap;
                      word-break: break-all;
                      max-height: 200px;
                      overflow-y: auto;
                    "
                  >
                    {{ serializeObject(node.value, { maxDepth: 2, maxArrayLength: 20 }) }}
                  </div>
                </template>
              </div>
            </div>
          </template>
        </template>
      </template>
    </slot>
  </FieldView>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { matBarChart } from '@quasar/extras/material-icons'
import { serializeObject } from '@taskyon/common/modules/serializeObject'
import { countLeaves } from '@taskyon/common/modules/utils'
import FieldView from './FieldView.vue'
import JsonInput from './JsonInput.vue'
import InfoDialog from '../InfoDialog.vue'
import type { VariableNode } from './useVariableGraph'
import ListChart from '../ListChart.vue'

export type CustomRenderer = {
  match: (node: VariableNode) => boolean
  component: unknown
  props?: (node: VariableNode) => Record<string, unknown>
}

const props = defineProps<{
  node: VariableNode
  readOnly?: boolean
  separateLabels?: boolean
  debounce?: number
  copyBtn?: boolean
  inputFieldBehavior?: 'auto' | 'textarea' | 'autogrow'
  listSummary?: number
  chartPaths?: string[]
  fullViewPaths?: string[]
  renderers?: CustomRenderer[]
  showLabel?: boolean
  showMissingIndicator?: boolean
  schemaDocumentation?: boolean
}>()

const emit = defineEmits<{
  (e: 'update', value: unknown): void
  (e: 'reset'): void
  (e: 'copy'): void
  (e: 'toggle-chart', id: string): void
  (e: 'toggle-full-view', payload: { id: string; value: unknown }): void
}>()

const readOnly = props.readOnly ?? false
const debounce = props.debounce ?? 100
const copyBtn = props.copyBtn ?? false
const inputFieldBehavior = props.inputFieldBehavior ?? 'auto'
const listSummary = props.listSummary ?? 10
const chartPaths = computed(() => props.chartPaths ?? [])
const fullViewPaths = computed(() => props.fullViewPaths ?? [])
const renderers = props.renderers ?? []
const showLabel = props.showLabel ?? true
const showMissingIndicator = props.showMissingIndicator ?? true
const schemaDocumentation = props.schemaDocumentation ?? false

const schemaType = computed(() => {
  const type = props.node.schema?.type
  if (Array.isArray(type)) return type.join(' | ')
  return type ?? props.node.kind
})

const fieldItem = computed(() => ({
  ...(props.node.icon ? { icon: props.node.icon } : {}),
  ...(props.node.description ? { description: props.node.description } : {}),
  ...(props.node.label ? { label: props.node.label } : {}),
  ...(props.node.default !== undefined ? { default: props.node.default } : {}),
  ...(props.node.required === false ? { optional: true } : {}),
}))

const emitUpdate = (value: unknown) => emit('update', value)

const customRenderer = computed(() => renderers.find((renderer) => renderer.match(props.node)))
const customComponent = computed(() => customRenderer.value?.component ?? null)
const customComponentProps = computed(() => customRenderer.value?.props?.(props.node) ?? {})

const isLarge = (val: unknown) => {
  if (Array.isArray(val) && val.length > listSummary) return true
  return countLeaves(val) > listSummary
}

const isNumericArray = (val: unknown): boolean => {
  if (!Array.isArray(val) || val.length === 0) return false
  const first = val[0]
  if (Array.isArray(first)) {
    return val.every((row) => Array.isArray(row) && row.every((n) => typeof n === 'number'))
  }
  return val.every((n) => typeof n === 'number')
}

const chartEnabled = computed(() => chartPaths.value.includes(props.node.id))
const fullViewEnabled = computed(() => fullViewPaths.value.includes(props.node.id))

const formatDate = (ts?: number) => (ts ? new Date(ts).toISOString().slice(0, 10) : '')
const formatTime = (ts?: number) => (ts ? new Date(ts).toISOString().slice(11, 16) : '')

const updateDateTime = (date: string | null, time: string | null) => {
  const ts = typeof props.node.value === 'number' ? props.node.value : Date.now()
  const d = new Date(ts)

  if (date) {
    const [y = 1970, m = 1, day = 1] = date.split('-').map(Number)
    d.setFullYear(y, m - 1, day)
  }
  if (time) {
    const [h = 0, min = 0] = time.split(':').map(Number)
    d.setHours(h, min)
  }
  emitUpdate(d.getTime())
}

const getInitValue = (): unknown => {
  const schema = props.node.schema as Record<string, unknown> | undefined
  if (!schema || typeof schema !== 'object') return ''

  const withDefault = schema.default
  if (withDefault !== undefined) return withDefault

  const schemaType = Array.isArray(schema.type) ? schema.type[0] : schema.type

  if (!schemaType) {
    const unionDefs = [
      ...(Array.isArray(schema.oneOf) ? schema.oneOf : []),
      ...(Array.isArray(schema.anyOf) ? schema.anyOf : []),
    ].filter((entry) => entry && typeof entry === 'object') as Array<Record<string, unknown>>
    if (unionDefs.length) {
      const preferredTypeOrder = ['number', 'integer', 'string', 'boolean', 'array', 'object']
      const selectedSchema =
        preferredTypeOrder
          .map((expectedType) =>
            unionDefs.find((entry) => {
              const entryType = Array.isArray(entry.type) ? entry.type[0] : entry.type
              return entryType === expectedType
            }),
          )
          .find(Boolean) ?? unionDefs[0]
      const childType = Array.isArray(selectedSchema?.type)
        ? selectedSchema?.type[0]
        : selectedSchema?.type
      if (childType === 'object') return {}
      if (childType === 'array') return []
      if (childType === 'boolean') return false
      if (childType === 'number' || childType === 'integer') return 0
      if (childType === 'string') return ''
    }
  }

  switch (schemaType) {
    case 'object':
      return {}
    case 'array':
      return []
    case 'boolean':
      return false
    case 'number':
    case 'integer':
      return 0
    default:
      return ''
  }
}

const enableField = () => {
  emitUpdate(getInitValue())
}
</script>
