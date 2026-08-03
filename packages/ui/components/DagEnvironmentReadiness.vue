<template>
  <div class="dag-environment-readiness column no-wrap fit">
    <div class="row items-center q-pa-sm q-gutter-sm">
      <div class="text-subtitle2">Environment readiness</div>
      <q-space />
      <q-badge outline color="primary">Sources {{ sources.length }}</q-badge>
      <q-badge outline color="secondary">Potential {{ potentialLeaves.length }}</q-badge>
    </div>
    <q-separator />
    <q-scroll-area class="col">
      <q-list separator>
        <q-item-label header>Definite environmental sources</q-item-label>
        <q-item v-for="node in sources" :key="node.id" clickable @click="emit('select', node.id)">
          <q-item-section avatar>
            <q-icon :name="statusIcon(node.status)" :color="statusColor(node.status)" />
          </q-item-section>
          <q-item-section>
            <q-item-label>{{ node.label }}</q-item-label>
            <q-item-label caption>{{
              node.manifestSummary ?? 'No manifest recorded'
            }}</q-item-label>
          </q-item-section>
          <q-item-section v-if="node.status === 'failed'" side>
            <q-btn
              dense
              flat
              round
              icon="error_outline"
              aria-label="Show source failure"
              @click.stop="emit('showFailure', node.id)"
            />
          </q-item-section>
        </q-item>

        <q-item-label header>Potential environmental origins</q-item-label>
        <q-item
          v-for="node in potentialLeaves"
          :key="node.id"
          clickable
          @click="emit('select', node.id)"
        >
          <q-item-section avatar><q-icon name="help_outline" color="secondary" /></q-item-section>
          <q-item-section>
            <q-item-label>{{ node.label }}</q-item-label>
            <q-item-label caption>Pure upstream leaf; meaning is not inferred.</q-item-label>
          </q-item-section>
        </q-item>
      </q-list>
    </q-scroll-area>
  </div>
</template>

<script setup lang="ts">
type NodeStatus = 'idle' | 'running' | 'cached' | 'completed' | 'failed' | 'blocked'

defineProps<{
  sources: Array<{
    id: string
    label: string
    status: NodeStatus
    manifestSummary?: string
  }>
  potentialLeaves: Array<{ id: string; label: string }>
}>()

const emit = defineEmits<{
  select: [nodeId: string]
  showFailure: [nodeId: string]
}>()

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
.dag-environment-readiness
  min-width: 0
  min-height: 0
</style>
