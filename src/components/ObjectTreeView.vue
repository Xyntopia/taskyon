<template>
  <q-tree :nodes="value" node-key="label"> </q-tree>
</template>

<script setup lang="ts">
import { computed, defineProps } from 'vue';
import { QTreeNode } from 'quasar';
import { useTaskyonStore } from 'stores/taskyonState';
import ObjectTreeView from 'components/ObjectTreeView.vue';

const state = useTaskyonStore();
const { Tasks, ...chatStateProperties } = state.chatState;

/*const props = defineProps<{
  value: Record<string, unknown>;
}>();*/

const convertedNodes = computed(() => {
  return convertObjectToNodes(chatStateProperties);
});

const value = convertedNodes

function convertObjectToNodes(obj: Record<string, unknown>): QTreeNode[] {
  return Object.keys(obj).map((key) => {
    const value = obj[key];
    const node: QTreeNode = { label: key };

    if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
      node.children = convertObjectToNodes(value as Record<string, unknown>);
    }

    return node;
  });
}
</script>
