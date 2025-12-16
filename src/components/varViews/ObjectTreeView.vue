<!--ObjectTreeView.vue-->
<template>
  <q-tree
    v-if="modelValue"
    :nodes="nodeTree"
    node-key="key"
    v-bind="$attrs"
    class="object-tree-view"
    @lazy-load="onLazyLoad"
  >
    <!--This is only used for debuging..-->
    <!--template #default-header="prop">
      {{ prop.node }}
    </template-->
    <!--for all the component which explicitly want to remove the header...-->
    <template #default-header></template>

    <template #header-object="prop">
      <FieldView
        :item="prop.node"
        show-label
        :copy="copyBtn"
        @copy="copyNodeValue(prop.node.path)"
        @reset="updateValue(prop.node.path, prop.node.default)"
      />
    </template>

    <template #body-unknown="prop">
      <FieldView
        :show-label="separateLabels"
        reset
        :item="prop.node"
        :copy="copyBtn"
        @copy="copyNodeValue(prop.node.path)"
        @reset="updateValue(prop.node.path, prop.node.default)"
      >
        <InfoDialog label="This field can’t be changed right now." :round="false" :icon="matInfo">
          {{ prop.node }}
        </InfoDialog>
      </FieldView>
    </template>

    <template #body-text="prop">
      <FieldView
        :show-label="separateLabels"
        :item="prop.node"
        reset
        :copy="copyBtn"
        @copy="copyNodeValue(prop.node.path)"
        @reset="updateValue(prop.node.path, prop.node.default)"
      >
        <q-input
          :readonly="readOnly"
          filled
          :label="separateLabels ? '' : prop.node.label"
          input-style="max-height: 300px"
          type="textarea"
          :debounce="debounce"
          :model-value="prop.node.value"
          @update:model-value="(value: unknown) => updateValue(prop.node.path, value)"
        />
      </FieldView>
    </template>

    <template #body-list="prop">
      <FieldView
        :show-label="separateLabels"
        :item="prop.node"
        reset
        :copy="copyBtn"
        @copy="copyNodeValue(prop.node.path)"
        @reset="updateValue(prop.node.path, prop.node.default)"
      >
        <div class="column q-gutter-sm">
          <!-- Row with chart toggle button -->
          <div class="row items-center q-gutter-xs">
            <q-btn
              flat
              dense
              size="sm"
              :icon="matBarChart"
              :color="chartPaths?.includes(String(prop.node.key)) ? 'primary' : 'grey'"
              @click.stop="toggleChartPath(String(prop.node.key))"
            >
              <q-tooltip>
                {{ chartPaths?.includes(String(prop.node.key)) ? 'Hide chart' : 'Show chart' }}
              </q-tooltip>
            </q-btn>

            <!-- Optional: show brief info about the array -->
            <div class="text-caption text-grey">
              <template
                v-if="
                  Array.isArray(prop.node.value) &&
                  prop.node.value.length > 0 &&
                  prop.node.value.every((r: unknown) => Array.isArray(r))
                "
              >
                <div>
                  2D array of length {{ countLeaves(prop.node.value) }} [{{
                    prop.node.value.length
                  }},
                  {{
                    Math.max(
                      ...prop.node.value.map((r: unknown) => (Array.isArray(r) ? r.length : 0)),
                    )
                  }}
                  (max)]
                </div>
              </template>
              <template v-else>
                <div>Array of length {{ prop.node.value.length }}</div>
              </template>
            </div>
          </div>

          <!-- Content: either chart or original editor/summary -->
          <div>
            <template v-if="chartPaths?.includes(String(prop.node.key))">
              <!-- When chart is active, replace JSON input with chart -->
              <ListChart :value="prop.node.value" />
            </template>
            <template v-else>
              <!-- Original behavior (JSON editor or summary) -->
              <json-input
                v-if="countLeaves(prop.node.value) < listSummary"
                :readonly="readOnly"
                auto-save
                filled
                :label="separateLabels ? '' : prop.node.label"
                :model-value="prop.node.value"
                style="min-width: 200px"
                @update:model-value="(value: unknown) => updateValue(prop.node.path, value)"
              />
            </template>
          </div>
        </div>
      </FieldView>
    </template>

    <template #body-string="prop">
      <FieldView
        :show-label="separateLabels"
        :item="prop.node"
        reset
        :copy="copyBtn"
        @copy="copyNodeValue(prop.node.path)"
        @reset="updateValue(prop.node.path, prop.node.default)"
      >
        <q-input
          :readonly="readOnly"
          style="min-width: 200px"
          :label="separateLabels ? '' : prop.node.label"
          filled
          dense
          autogrow
          :type="typeof prop.node.value === 'number' ? 'text' : 'text'"
          :debounce="debounce"
          :model-value="prop.node.value"
          @update:model-value="(value: unknown) => updateValue(prop.node.path, value)"
        />
      </FieldView>
    </template>

    <template #body-boolean="prop">
      <FieldView
        :show-label="separateLabels"
        :item="prop.node"
        reset
        :copy="copyBtn"
        @copy="copyNodeValue(prop.node.path)"
        @reset="updateValue(prop.node.path, prop.node.default)"
      >
        <q-chip
          v-if="readOnly"
          :icon="prop.node.value ? prop.node.onIcon : prop.node.offIcon"
          :color="prop.node.value ? 'positive' : 'negative'"
          text-color="white"
          :label="prop.node.value ? 'Yes' : 'No'"
        />
        <q-toggle
          v-else
          dense
          size="lg"
          left-label
          :label="separateLabels ? '' : prop.node.label"
          :checked-icon="prop.node.onIcon"
          :unchecked-icon="prop.node.offIcon"
          color="secondary"
          :model-value="prop.node.value"
          @update:model-value="(value: unknown) => updateValue(prop.node.path, value)"
        />
      </FieldView>
    </template>

    <template #body-number="prop">
      <FieldView
        :show-label="separateLabels"
        :item="prop.node"
        reset
        :copy="copyBtn"
        @copy="copyNodeValue(prop.node.path)"
        @reset="updateValue(prop.node.path, prop.node.default)"
      >
        <q-input
          :readonly="readOnly"
          style="min-width: 200px"
          :label="separateLabels ? '' : prop.node.label"
          filled
          dense
          type="number"
          :debounce="debounce"
          :model-value="prop.node.value"
          @update:model-value="(value: unknown) => updateValue(prop.node.path, Number(value))"
        />
      </FieldView>
    </template>

    <template #body-enum="prop">
      <FieldView
        :show-label="separateLabels"
        :item="prop.node"
        reset
        :copy="copyBtn"
        @copy="copyNodeValue(prop.node.path)"
        @reset="updateValue(prop.node.path, prop.node.default)"
      >
        <q-select
          :disable="readOnly"
          filled
          dense
          emit-value
          :label="separateLabels ? '' : prop.node.label"
          :options="prop.node.options.map((v: string) => ({ label: String(v), value: v }))"
          :model-value="prop.node.value"
          @update:model-value="(val) => updateValue(prop.node.path, val)"
        />
      </FieldView>
    </template>

    <template #body-color="prop">
      <FieldView
        :show-label="separateLabels"
        :item="prop.node"
        reset
        :copy="copyBtn"
        @copy="copyNodeValue(prop.node.path)"
        @reset="updateValue(prop.node.path, prop.node.default)"
      >
        <q-input
          filled
          dense
          :disable="readOnly"
          hide-bottom-space
          hide-hint
          :model-value="prop.node.value"
          :rules="['anyColor']"
          style="max-width: 100px"
          @update:model-value="(val: string | number | null) => updateValue(prop.node.path, val)"
        >
          <template #append>
            <div
              class="cursor-pointer"
              :style="{
                width: '0.8em',
                height: '0.8em',
                borderRadius: '50%',
                background: prop.node.value || '#000',
              }"
            >
              <q-popup-proxy cover transition-show="scale" transition-hide="scale">
                <q-color
                  :disable="readOnly"
                  :model-value="prop.node.value"
                  @update:model-value="(val: string | null) => updateValue(prop.node.path, val)"
                />
              </q-popup-proxy>
            </div>
          </template>
        </q-input>
      </FieldView>
    </template>

    <template #body-timestamp="prop">
      <FieldView
        :show-label="separateLabels"
        :item="prop.node"
        reset
        :copy="copyBtn"
        @copy="copyNodeValue(prop.node.path)"
        @reset="updateValue(prop.node.path, prop.node.default)"
      >
        <!-- split date + time inputs -->
        <div class="row q-col-gutter-sm">
          <q-input
            filled
            dense
            type="date"
            :model-value="formatDate(prop.node.value)"
            @update:model-value="
              (val) => updateDateTime(prop.node.path, val ? String(val) : null, null)
            "
          />
          <q-input
            filled
            dense
            type="time"
            :model-value="formatTime(prop.node.value)"
            @update:model-value="
              (val) => updateDateTime(prop.node.path, null, val ? String(val) : null)
            "
          />
        </div>
      </FieldView>
    </template>
  </q-tree>

  <div v-else>no input data!</div>
</template>

<script setup lang="ts">
import { matBarChart, matInfo } from '@quasar/extras/material-icons'
import { type JSONSchema7 } from 'json-schema'
import { type QTreeNode } from 'quasar'
import { copyToClipboard, countLeaves } from 'src/modules/utils'
import { computed } from 'vue'
import type z from 'zod'
import InfoDialog from '../InfoDialog.vue'
import FieldView from './FieldView.vue'
import JsonInput from './JsonInput.vue'
import ListChart from './ListChart.vue'

const {
  readOnly = false,
  inputFieldBehavior = 'auto',
  separateLabels = true,
  debounce = 100,
  schema,
  descriptionsAsLabels = false,
  hideMissing = false,
  copyBtn = false,
  lazyRender = false,
  listSummary = 10,
} = defineProps<{
  readOnly?: boolean
  inputFieldBehavior?: 'auto' | 'textarea' | 'autogrow'
  separateLabels?: boolean
  debounce?: number
  schema?: JSONSchema7 | z.core.JSONSchema.BaseSchema | undefined
  descriptionsAsLabels?: boolean
  hideMissing?: boolean
  copyBtn?: boolean
  lazyRender?: boolean
  listSummary?: number
}>()

const modelValue = defineModel<Record<string, unknown> | undefined>({
  required: true,
})

const chartPaths = defineModel<string[]>('chartPaths', {
  default: () => [],
})

const updateValue = (keyPath: string[], value: unknown) => {
  if (!modelValue.value) return

  let target: Record<string, unknown> = modelValue.value
  for (let i = 0; i < keyPath.length - 1; i++) {
    target = target[keyPath[i]!] as Record<string, unknown>
  }
  target[keyPath[keyPath.length - 1]!] = value
}

const toggleChartPath = (dotPath: string) => {
  const current = chartPaths.value ?? []
  const idx = current.indexOf(dotPath)
  if (idx === -1) {
    chartPaths.value = [...current, dotPath]
  } else {
    chartPaths.value = current.filter((p) => p !== dotPath)
  }
}

const getValueByPath = (obj: unknown, path: string[]): unknown => {
  let cur = obj
  for (const segment of path) {
    if (cur == null || typeof cur !== 'object') return undefined
    cur = (cur as Record<string, unknown>)[segment]
  }
  return cur
}

// Optional helper:
// quick & shallow check if an object has any non-missing *immediate* children.
const hasAnyVisibleImmediateChild = (
  obj: Record<string, unknown>,
  subschema?: JSONSchema7 | z.core.JSONSchema.BaseSchema,
): boolean => {
  if (!hideMissing) {
    return Object.keys(obj).length > 0
  }

  if (subschema && 'properties' in subschema && subschema.type === 'object') {
    return Object.entries(subschema.properties ?? {}).some(([k]) => {
      const v = obj[k]
      return v !== undefined && v !== null && v !== ''
    })
  }

  return Object.values(obj).some((v) => v !== undefined && v !== null && v !== '')
}

const transformToTreeNodes = (
  obj: Record<string, unknown>,
  schema?: JSONSchema7 | z.core.JSONSchema.BaseSchema,
  keyPath: string[] = [],
  useLazy: boolean = false,
): QTreeNode[] => {
  const mapEntry = (
    key: string,
    value: unknown,
    subschema:
      | (JSONSchema7 & {
          icon?: string | undefined
          offIcon?: string | undefined
          onIcon?: string | undefined
          label?: string | undefined
        })
      | undefined,
    path: string[],
  ): QTreeNode | null => {
    if (hideMissing && (value === undefined || value === null || value === '')) {
      return null
    }

    const newPath = [...path, key]

    const label =
      (descriptionsAsLabels ? subschema?.description?.trim() : undefined) ?? subschema?.label ?? key

    const base: QTreeNode = {
      label,
      description: subschema?.description?.trim(),
      key: newPath.join('.'),
      path: newPath,
      schema: subschema,
      children: [],
    }
    if (subschema?.icon) base.icon = subschema.icon
    if (subschema?.offIcon) base.offIcon = subschema.offIcon
    if (subschema?.onIcon) base.onIcon = subschema.onIcon
    if (subschema?.default) base.default = subschema.default

    const isUndef = value === undefined || value === null
    const runtimeType = subschema?.enum
      ? 'enum'
      : subschema?.format === 'timestamp'
        ? 'timestamp'
        : subschema?.format === 'color'
          ? 'color'
          : (subschema?.type ?? (Array.isArray(value) ? 'array' : typeof value))

    switch (runtimeType) {
      case 'enum': {
        const actualVal = isUndef ? (subschema!.default ?? subschema!.enum![0]) : value
        return {
          ...base,
          value: actualVal,
          options: subschema!.enum as Array<string | number>,
          body: 'enum',
        }
      }

      case 'timestamp': {
        const ts = isUndef ? (subschema!.default ?? Date.now()) : (value as number)
        return {
          ...base,
          value: ts,
          body: 'timestamp',
        }
      }

      case 'color': {
        const actualVal = isUndef ? (subschema!.default ?? '#000000') : value
        return {
          ...base,
          value: actualVal as string,
          body: 'color',
        }
      }

      case 'object': {
        const childObj =
          !isUndef && typeof value === 'object' && !Array.isArray(value)
            ? (value as Record<string, unknown>)
            : {}

        if (useLazy) {
          // LAZY MODE:
          // - Do NOT build full subtree here
          // - Keep node only if it "might" have visible children
          const hasChildren = hasAnyVisibleImmediateChild(childObj, subschema)

          if (hideMissing && !hasChildren) {
            // NOTE: Slightly approximate vs. full deep check, but much faster.
            return null
          }

          return {
            ...base,
            value: null,
            children: [],
            header: 'object',
            lazy: hasChildren, // Quasar will trigger @lazy-load when expanded
          }
        } else {
          // NON-LAZY MODE: original behavior
          const children = transformToTreeNodes(childObj, subschema, newPath, useLazy)

          if (hideMissing && children.length === 0) {
            return null
          }

          return {
            ...base,
            value: null,
            children,
            header: 'object',
          }
        }
      }

      case 'array': {
        const arrVal =
          !isUndef && Array.isArray(value) ? (value as unknown[]) : isUndef ? [] : [value] // fallback; optional

        // Here you can add extra logic to guard against very large arrays
        // e.g. attach metadata for plots, or flag "tooLarge" based on length.
        // For now we just forward the full array to the 'list' body.
        return {
          ...base,
          value: arrVal,
          body: 'list',
        }
      }

      case 'string': {
        const actualVal = isUndef ? '' : (value as string)
        const isSingleLine =
          actualVal.length < 100 && !actualVal.includes('\n') && inputFieldBehavior !== 'textarea'
        return {
          ...base,
          value: actualVal,
          body: isSingleLine ? 'string' : 'text',
        }
      }

      case 'boolean':
        return {
          ...base,
          value: !!value,
          body: 'boolean',
        }

      case 'number':
      case 'integer': {
        const numVal = isUndef ? undefined : (value as number)
        return {
          ...base,
          value: numVal,
          body: 'number',
        }
      }

      default:
        // fallback: show raw JSON
        return {
          ...base,
          value: JSON.stringify(value),
          body: 'unknown',
        }
    }
  }

  if (schema && 'type' in schema && schema.type === 'object' && 'properties' in schema) {
    const schemaProps = (schema.properties ?? {}) as Record<string, JSONSchema7>

    // union of schema keys + actual object keys
    const allKeys = Array.from(new Set([...Object.keys(schemaProps), ...Object.keys(obj)]))

    return allKeys
      .filter((key) => {
        if (!hideMissing) return true
        const v = obj[key]
        return v !== undefined && v !== null && v !== ''
      })
      .map((key) => {
        const subschema = schemaProps[key]
        const value = obj[key]
        return mapEntry(key, value, subschema, keyPath)
      })
      .filter((n): n is QTreeNode => n !== null)
  }

  // No schema: derive from runtime object
  return Object.entries(obj)
    .filter(([, value]) => !hideMissing || (value !== undefined && value !== null && value !== ''))
    .map(([key, value]) => mapEntry(key, value, undefined, keyPath))
    .filter((n): n is QTreeNode => n !== null)
}

const nodeTree = computed(() => {
  if (!modelValue.value) return []
  // For the root level, pass lazyRender flag
  return transformToTreeNodes(modelValue.value, schema, [], lazyRender)
})

type LazyLoadParams = {
  node: QTreeNode & {
    path: string[]
    schema?: JSONSchema7 | z.core.JSONSchema.BaseSchema
  }
  key: string | number
  done: (children: QTreeNode[]) => void
  fail: () => void
}

const onLazyLoad = ({ node, done, fail }: LazyLoadParams) => {
  try {
    if (!modelValue.value) {
      done([])
      return
    }

    // Re-read the latest value for this node from modelValue
    const raw = getValueByPath(modelValue.value, node.path)
    const obj =
      raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {}

    const subschema = node.schema

    // Build children for THIS object node only
    const children = transformToTreeNodes(obj, subschema, node.path, lazyRender)

    done(children)
  } catch (err) {
    console.error('Lazy load failed', err)
    fail()
  }
}

const formatDate = (ts?: number) => (ts ? new Date(ts).toISOString().slice(0, 10) : '')

const formatTime = (ts?: number) => (ts ? new Date(ts).toISOString().slice(11, 16) : '')

const updateDateTime = (path: string[], date: string | null, time: string | null) => {
  const ts = modelValue.value ? (getValueByPath(modelValue.value, path) as number) : Date.now()
  const d = new Date(ts || Date.now())

  if (date) {
    const [y = 1970, m = 1, day = 1] = date.split('-').map(Number)
    d.setFullYear(y, m - 1, day)
  }
  if (time) {
    const [h = 0, min = 0] = time.split(':').map(Number)
    d.setHours(h, min)
  }

  updateValue(path, d.getTime())
}

const copyNodeValue = (path: string[]) => {
  if (!modelValue.value) return

  let target: unknown = modelValue.value
  for (const key of path) {
    if (target == null || typeof target !== 'object') {
      break
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    target = (target as any)[key]
  }

  // You can decide how to handle undefined; here we still stringify it
  const json = JSON.stringify(target, null, 2)
  copyToClipboard(json)
}
</script>

<style scoped lang="sass">
.q-tree--dense .q-tree__node--child
    padding-left: 0
</style>
