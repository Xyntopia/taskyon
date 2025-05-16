<template>
  <q-tree
    v-if="modelValue"
    :nodes="nodeTree"
    node-key="label"
    v-bind="$attrs"
    class="object-tree-view"
  >
    <!--This is only used for debuging..-->
    <!--template #default-header="prop">
      {{ prop.node }}
    </template-->
    <!--for all the component which explicitly want to remove the header...-->
    <template #default-header></template>
    <template #header-object="prop">
      <div class="row items-center">
        <div class="col">
          {{ prop.node.label }}
        </div>
        <info-dialog v-if="prop.node.description && !descriptionsAsLabels">
          {{ prop.node.description }}
        </info-dialog>
      </div>
    </template>
    <template #body-unknown="prop">
      <div class="row">
        unknown object type
        <info-dialog>
          {{ prop.node }}
        </info-dialog>
      </div>
    </template>
    <template #body-text="prop">
      <div class="row">
        <!--text-->
        <div v-if="separateLabels" class="col-auto" style="min-width: 200px">
          {{ prop.node.label }}:
        </div>
        <q-input
          :readonly="readOnly"
          class="col"
          filled
          :label="separateLabels ? undefined : prop.node.label"
          input-style="max-height: 300px"
          type="textarea"
          :debounce="debounce"
          :model-value="prop.node.value"
          @update:model-value="(value: unknown) => updateValue(prop.node.path, value)"
        >
        </q-input>
        <info-dialog v-if="prop.node.description && !descriptionsAsLabels">
          {{ prop.node.description }}
        </info-dialog>
      </div>
    </template>
    <template #body-list="prop">
      <div class="row">
        <div v-if="separateLabels" class="col-auto" style="min-width: 200px">
          {{ prop.node.label }}:
        </div>
        <json-input
          :readonly="readOnly"
          class="col"
          auto-save
          filled
          :model-value="prop.node.value"
          @update:model-value="(value: unknown) => updateValue(prop.node.path, value)"
          style="min-width: 200px"
        />
        <info-dialog v-if="prop.node.description && !descriptionsAsLabels">
          {{ prop.node.description }}
        </info-dialog>
      </div>
    </template>
    <template #body-string="prop">
      <div class="row">
        <div v-if="separateLabels" class="col-auto" style="min-width: 200px">
          {{ prop.node.label }}:
        </div>
        <q-input
          :readonly="readOnly"
          class="col"
          style="min-width: 200px"
          :label="separateLabels ? undefined : prop.node.label"
          filled
          dense
          autogrow
          :type="typeof prop.node.value === 'number' ? 'text' : 'text'"
          :debounce="debounce"
          :model-value="prop.node.value"
          @update:model-value="(value: unknown) => updateValue(prop.node.path, value)"
        >
        </q-input>
        <info-dialog v-if="prop.node.description && !descriptionsAsLabels">
          {{ prop.node.description }}
        </info-dialog>
      </div>
    </template>
    <template #body-boolean="prop">
      <div class="row q-gutter-sm items-center">
        <q-icon v-if="prop.node.icon" size="sm" :name="prop.node.icon"></q-icon>
        <div v-if="separateLabels" class="col-auto" style="min-width: 200px">
          {{ prop.node.label }}:
        </div>
        <q-toggle
          :disable="readOnly"
          dense
          size="lg"
          left-label
          :checked-icon="prop.node.onIcon"
          :unchecked-icon="prop.node.offIcon"
          color="secondary"
          :model-value="prop.node.value"
          @update:model-value="(value: unknown) => updateValue(prop.node.path, value)"
        >
        </q-toggle>
        <info-dialog v-if="prop.node.description && !descriptionsAsLabels">
          {{ prop.node.description }}
        </info-dialog>
      </div>
    </template>
    <template #body-number="prop">
      <div class="row">
        <div v-if="separateLabels" class="col-auto" style="min-width: 200px">
          {{ prop.node.label }}:
        </div>
        <q-input
          :readonly="readOnly"
          class="col"
          style="min-width: 200px"
          :label="separateLabels ? undefined : prop.node.label"
          filled
          dense
          type="number"
          :debounce="debounce"
          :model-value="prop.node.value"
          @update:model-value="(value: unknown) => updateValue(prop.node.path, Number(value))"
        />
      </div>
      <info-dialog v-if="prop.node.description && !descriptionsAsLabels">
        {{ prop.node.description }}
      </info-dialog>
    </template>
  </q-tree>
  <div v-else>no input data!</div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { type QTreeNode } from 'quasar'
import JsonInput from 'components/JsonInput.vue' // Adjust the path as necessary
import InfoDialog from 'components/InfoDialog.vue'
import type { JSONSchema7 } from 'json-schema'
import type z from 'zod'

const {
  readOnly = false,
  inputFieldBehavior = 'auto',
  separateLabels = true,
  debounce = 100,
  schema,
  descriptionsAsLabels = false,
} = defineProps<{
  readOnly?: boolean
  inputFieldBehavior?: 'auto' | 'textarea' | 'autogrow'
  separateLabels?: boolean
  debounce?: number
  schema?: JSONSchema7 | z.core.JSONSchema.BaseSchema | undefined
  descriptionsAsLabels?: boolean
}>()

const modelValue = defineModel<Record<string, unknown> | undefined>({
  required: true,
})

const updateValue = (keyPath: string[], value: unknown) => {
  if (!modelValue.value) return

  // walk down the existing object…
  let target: Record<string, unknown> = modelValue.value
  for (let i = 0; i < keyPath.length - 1; i++) {
    target = target[keyPath[i]!] as Record<string, unknown>
  }

  // …and set the leaf. Vue will pick up the change.
  target[keyPath[keyPath.length - 1]!] = value
}

const transformToTreeNodes = (
  obj: Record<string, unknown>,
  schema?: JSONSchema7 | z.core.JSONSchema.BaseSchema,
  keyPath: string[] = [],
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
  ): QTreeNode => {
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

    const isUndef = value === undefined || value === null
    const runtimeType = subschema?.type ?? (Array.isArray(value) ? 'array' : typeof value)

    // TODO: what do we do if schemaType is an array?
    switch (runtimeType) {
      case 'object': {
        // if undefined or not actually an object, start with {}
        const childObj = !isUndef && typeof value === 'object' && !Array.isArray(value) ? value : {}
        return {
          ...base,
          value: null,
          children: transformToTreeNodes(childObj as Record<string, unknown>, subschema, newPath),
          header: 'object',
        }
      }
      case 'array':
        // unspecified arrays show the list widget, value may be `undefined` or an actual array
        return {
          ...base,
          value: isUndef ? [] : (value as unknown[]),
          body: 'list',
        }
      case 'string': {
        // pick between 'string' (single-line) vs 'text' (textarea) in one spot
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
      case 'number': {
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

  if (schema?.type === 'object' && schema.properties) {
    return Object.entries(schema.properties).map(([key, subschema]) =>
      mapEntry(key, obj[key], subschema as JSONSchema7, keyPath),
    )
  }

  return Object.entries(obj).map(([key, value]) => mapEntry(key, value, undefined, keyPath))
}

const nodeTree = computed(() => {
  if (modelValue.value) {
    return transformToTreeNodes(modelValue.value, schema)
  } else {
    return []
  }
})
</script>
