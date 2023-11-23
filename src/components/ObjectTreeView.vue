<template>
  <q-tree :nodes="nodeTree" node-key="label">
    <template v-slot:body-text="prop">
      <q-input
        filled
        :label="prop.node.label"
        type="textarea"
        :model-value="prop.node.value"
        @update:modelValue="(value) => updateValue(prop.node.path, value)"
      />
    </template>
    <template v-slot:header-none> </template>
    <template v-slot:body-string="prop">
      <q-input
        :label="prop.node.label"
        filled
        dense
        autogrow
        :debounce="500"
        :model-value="prop.node.value"
        @update:modelValue="(value) => updateValue(prop.node.path, value)"
      />
    </template>
    <template v-slot:header-boolean="prop">
      <q-toggle
        :label="prop.node.label"
        left-label
        color="secondary"
        :model-value="prop.node.value"
        @update:modelValue="(value) => updateValue(prop.node.path, value)"
      />
    </template>
  </q-tree>
</template>

<script setup lang="ts">
import { computed, defineProps, reactive, watch, nextTick } from 'vue';
import { QTreeNode } from 'quasar';

const props = defineProps({
  modelValue: {
    type: Object,
    required: true,
  },
});

// Initialize the reactive tree object with the modelValue
const treeObject = reactive({ ...props.modelValue });

const emit = defineEmits(['update:modelValue']);

// Watch for changes in treeObject and emit the update event
watch(
  () => treeObject,
  (newValue) => {
    void nextTick(() => {
      emit('update:modelValue', newValue);
    });
  },
  { deep: true }
);

const updateValue = (keyPath: string[], value: any) => {
  let currentPart: Record<string, any> = treeObject;

  // Iterate over the keyPath to find the correct property to update
  for (let i = 0; i < keyPath.length - 1; i++) {
    currentPart = currentPart[keyPath[i]] as Record<string, any>;
  }

  // Update the value at the final key, with a type assertion
  currentPart[keyPath[keyPath.length - 1]] = value as unknown;
};

const transformToTreeNodes = (
  obj: Record<string, any>,
  keyPath: string[] = []
): QTreeNode[] => {
  return Object.entries(obj)
    .map(([key, value]) => {
      const newPath = [...keyPath, key];
      if (
        typeof value === 'object' &&
        value !== null &&
        !Array.isArray(value)
      ) {
        return {
          label: key,
          key: newPath.join('.'),
          value: null, // Placeholder, not used for objects
          children: transformToTreeNodes(value, newPath),
        };
      } else if (typeof value === 'string') {
        const node: QTreeNode = {
          label: key,
          key: newPath.join('.'),
          value: value,
          path: newPath,
          header: 'none',
        };
        value.length < 100 && !value.includes('\n')
          ? (node['body'] = 'string')
          : (node['body'] = 'text');
        return node;
      } else if (typeof value === 'boolean') {
        return {
          label: key,
          key: newPath.join('.'),
          value: value as string | boolean,
          path: newPath,
          header: 'boolean',
        };
      } else {
        return {
          label: key,
          key: newPath.join('.'),
          value: JSON.stringify(value),
          path: newPath,
          body: 'unknown',
        };
      }
    })
    .filter((x) => x != undefined);
};

const nodeTree = computed(() => transformToTreeNodes(treeObject));
</script>
