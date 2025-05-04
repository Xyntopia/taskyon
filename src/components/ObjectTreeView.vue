<template>
  <q-tree v-if="modelValue" :nodes="nodeTree" node-key="label" v-bind="$attrs">
    <template #body-text="prop">
      <div class="row">
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
    <template #header-none> </template>
    <template #body-list="prop">
      <div class="row">
        <div class="col-auto" style="min-width: 200px">{{ prop.node.label }}:</div>
        <json-input
          :readonly="readOnly"
          class="col"
          auto-save
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
    <template #header-boolean="prop">
      <q-toggle
        :disable="readOnly"
        style="min-width: 200px"
        :label="prop.node.label"
        left-label
        color="secondary"
        :model-value="prop.node.value"
        @update:model-value="(value: unknown) => updateValue(prop.node.path, value)"
      >
      </q-toggle>
      <info-dialog v-if="prop.node.description && !descriptionsAsLabels">
        {{ prop.node.description }}
      </info-dialog>
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
          @update:model-value="(value: unknown) => updateValue(prop.node.path, value)"
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
  schema?: JSONSchema7 | undefined
  descriptionsAsLabels?: boolean
}>()

const modelValue = defineModel<Record<string, unknown> | undefined>({
  required: true,
})

const updateValue = (keyPath: string[], value: unknown) => {
  if (modelValue.value) {
    // Create a new object to ensure reactivity
    const newValue = { ...modelValue.value }
    let currentPart: Record<string, unknown> = newValue

    // Iterate over the keyPath to find the correct property to update
    for (let i = 0; i < keyPath.length - 1; i++) {
      currentPart = currentPart[keyPath[i]!] as Record<string, unknown>
    }

    // Update the value at the final key
    currentPart[keyPath[keyPath.length - 1]!] = value

    // Emit the entire new object and emit vue events etc...
    modelValue.value = newValue
  }
}

const transformToTreeNodes = (
  obj: Record<string, unknown>,
  schema?: JSONSchema7,
  keyPath: string[] = [],
): QTreeNode[] => {
  const mapEntry = (
    key: string,
    value: unknown,
    subschema: JSONSchema7 | undefined,
    path: string[],
  ): QTreeNode => {
    const newPath = [...path, key]

    // === updated label logic ===
    let label = key
    if (descriptionsAsLabels) {
      label = subschema?.description?.trim() || key
    }

    // rest is unchanged…
    if (subschema?.type === 'object' && subschema.properties) {
      return {
        label,
        description: subschema?.description?.trim(),
        key: newPath.join('.'),
        value: null,
        children: transformToTreeNodes(
          value && typeof value === 'object' && !Array.isArray(value)
            ? (value as Record<string, unknown>)
            : {},
          subschema,
          newPath,
        ),
      }
    }
    if (Array.isArray(value)) {
      return { label, key: newPath.join('.'), value, path: newPath, body: 'list', header: 'none' }
    }
    if (typeof value === 'string') {
      const node: QTreeNode = {
        label,
        description: subschema?.description?.trim(),
        key: newPath.join('.'),
        value,
        path: newPath,
        header: 'none',
      }
      node.body =
        value.length < 100 && !value.includes('\n') && inputFieldBehavior !== 'textarea'
          ? 'string'
          : 'text'
      return node
    }
    if (typeof value === 'boolean') {
      return {
        label,
        description: subschema?.description?.trim(),
        key: newPath.join('.'),
        value,
        path: newPath,
        header: 'boolean',
      }
    }
    if (typeof value === 'number') {
      return {
        label,
        description: subschema?.description?.trim(),
        key: newPath.join('.'),
        value,
        path: newPath,
        header: 'none',
        body: 'string',
      }
    }
    return {
      label,
      description: subschema?.description?.trim(),
      key: newPath.join('.'),
      value: JSON.stringify(value),
      path: newPath,
      body: 'unknown',
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
    return transformToTreeNodes(modelValue.value, schema, undefined)
  } else {
    return []
  }
})
</script>
