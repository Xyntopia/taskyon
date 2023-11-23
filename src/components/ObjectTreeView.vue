<template>
  <q-tree dense :nodes="nodeTree" node-key="label">
    <template v-slot:body-text="prop">
      <q-input
        filled
        type="textarea"
        :model-value="prop.node.value"
        @update:modelValue="(value) => updateValue(prop.node.path, value)"
      />
    </template>
    <template v-slot:body-string="prop">
      <q-input
        filled
        dense
        autogrow
        :debounce="500"
        :model-value="prop.node.value"
        @update:modelValue="(value) => updateValue(prop.node.path, value)"
      />
    </template>
    <template v-slot:body-boolean="prop">
      <q-toggle
        :model-value="prop.node.value"
        @update:modelValue="(value) => updateValue(prop.node.value, value)"
      />
    </template>
  </q-tree>
</template>

<script setup lang="ts">
import { computed, defineProps, toRefs, Ref, reactive, ref } from 'vue';
import { QTreeNode } from 'quasar';
import { useTaskyonStore } from 'stores/taskyonState';
import ObjectTreeView from 'components/ObjectTreeView.vue';
import { notEqual } from 'assert';
import { storeToRefs } from 'pinia';
import { defaultTaskState } from 'src/modules/chat';

//const state = useTaskyonStore();
//const { Tasks, ...chatStateProperties } = toRefs(storeToRefs(state).chatState.value);

/*const props = defineProps<{
  value: Record<string, unknown>;
}>();*/

const originalChatStateProperties = defaultTaskState(); // Your original state

// Reactive reference to the original state
const chatState = reactive(originalChatStateProperties);

const updateValue = (keyPath: string[], value: any) => {
  console.log('change value');
  let currentPart: Record<string, any> = chatState as Record<string, any>;

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
  return Object.entries(obj).map(([key, value]) => {
    const newPath = [...keyPath, key];
    if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
      return {
        label: key,
        key: newPath.join('.'),
        value: null, // Placeholder, not used for objects
        children: transformToTreeNodes(value, newPath),
      };
    } else if (typeof value === 'string') {
      return {
        label: key,
        key: newPath.join('.'),
        value: value,
        path: newPath,
        body: value.length < 100 && !value.includes('\n') ? 'string' : 'text',
      };
    }
    return {
      label: key,
      key: newPath.join('.'),
      value: value as string | boolean,
      path: newPath,
      body: 'boolean',
    };
  });
};

const nodeTree = computed(() => transformToTreeNodes(chatState));
</script>
