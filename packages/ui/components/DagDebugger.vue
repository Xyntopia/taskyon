<template>
  <div class="dag-debugger fit row no-wrap">
    <q-list bordered separator class="dag-debugger__nodes">
      <q-item-label header>DAG execution</q-item-label>
      <q-item
        v-for="node in nodes"
        :key="node.id"
        clickable
        :active="node.id === selectedNodeId"
        @click="emit('update:selectedNodeId', node.id)"
      >
        <q-item-section avatar>
          <q-icon :name="statusIcon(node.status)" :color="statusColor(node.status)" />
        </q-item-section>
        <q-item-section>
          <q-item-label>{{ node.label }}</q-item-label>
          <q-item-label caption>{{ node.effect }} · {{ node.status }}</q-item-label>
        </q-item-section>
      </q-item>
    </q-list>

    <q-separator vertical />

    <div class="col column no-wrap q-pa-sm">
      <template v-if="selectedNode">
        <div class="row items-center q-gutter-sm">
          <div class="text-subtitle2">{{ selectedNode.label }}</div>
          <q-badge outline>{{ selectedNode.effect }}</q-badge>
          <q-badge :color="statusColor(selectedNode.status)">{{ selectedNode.status }}</q-badge>
        </div>
        <div class="text-caption text-grey-7 q-mt-xs text-mono">{{ selectedNode.id }}</div>
        <div v-if="selectedNode.error" class="text-negative q-mt-sm">
          {{ selectedNode.error }}
        </div>
        <div v-if="selectedNode.blockedBy?.length" class="q-mt-sm">
          Blocked by: {{ selectedNode.blockedBy.join(', ') }}
        </div>
        <q-separator class="q-my-sm" />
        <div class="text-caption text-grey-7">Structured log entries</div>
        <q-scroll-area class="col q-mt-xs">
          <q-list dense>
            <q-item v-for="(entry, index) in selectedLogs" :key="`${entry.timestamp}-${index}`">
              <q-item-section>
                <q-item-label>{{ entry.message }}</q-item-label>
                <q-item-label caption>{{ entry.timestamp }} · {{ entry.level }}</q-item-label>
              </q-item-section>
            </q-item>
          </q-list>
        </q-scroll-area>
      </template>
      <div v-else class="text-grey-7 q-pa-md">Select a node to inspect its execution.</div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'

type NodeStatus = 'idle' | 'running' | 'cached' | 'completed' | 'failed' | 'blocked'

const props = defineProps<{
  nodes: Array<{
    id: string
    label: string
    effect: 'pure' | 'source'
    status: NodeStatus
    error?: string
    blockedBy?: string[]
  }>
  logs: Array<{
    timestamp: string
    level: 'debug' | 'info' | 'warn' | 'error'
    message: string
    nodeId?: string
  }>
  selectedNodeId?: string
}>()

const emit = defineEmits<{ 'update:selectedNodeId': [nodeId: string] }>()
const selectedNode = computed(() => props.nodes.find((node) => node.id === props.selectedNodeId))
const selectedLogs = computed(() =>
  props.logs.filter((entry) => entry.nodeId === props.selectedNodeId),
)

const statusIcon = (status: NodeStatus) => {
  switch (status) {
    case 'failed':
      return 'error'
    case 'blocked':
      return 'block'
    case 'completed':
    case 'cached':
      return 'check_circle'
    case 'running':
      return 'sync'
    case 'idle':
      return 'radio_button_unchecked'
  }
}

const statusColor = (status: NodeStatus) => {
  if (status === 'failed') return 'negative'
  if (status === 'blocked') return 'warning'
  if (status === 'completed' || status === 'cached') return 'positive'
  return 'grey-7'
}
</script>

<style scoped lang="sass">
.dag-debugger
  min-width: 0
  min-height: 0

.dag-debugger__nodes
  width: 300px
  max-width: 40%
  overflow: auto
</style>
