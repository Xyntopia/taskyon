<template>
  <q-page class="taskyon-map-widget-page">
    <TaskyonGeoMapWidget v-if="state" :state="state" />
    <div v-else class="taskyon-map-widget-page__error">Invalid map widget payload.</div>
  </q-page>
</template>

<script setup lang="ts">
import TaskyonGeoMapWidget from '@taskyon/ui/gis/TaskyonGeoMapWidget.vue'
import {
  decodeTaskyonMapWidgetState,
  parseTaskyonMapWidgetState,
  type TaskyonMapWidgetState,
} from '@taskyon/ui/gis/taskyonMapWidget'
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useRoute } from 'vue-router'

const route = useRoute()

const postedState = ref<TaskyonMapWidgetState | null>(null)
const queryState = computed(() =>
  decodeTaskyonMapWidgetState(
    typeof route.query.state === 'string' ? route.query.state : undefined,
  ),
)
const state = computed(() => postedState.value ?? queryState.value)

const handleMessage = (event: MessageEvent) => {
  const data = event.data as { type?: unknown; state?: unknown } | null
  if (!data || data.type !== 'taskyon-map-widget-state') return
  const parsed = parseTaskyonMapWidgetState(data.state)
  if (parsed) {
    postedState.value = parsed
  }
}

onMounted(() => {
  window.addEventListener('message', handleMessage)
  if (window.parent && window.parent !== window) {
    window.parent.postMessage({ type: 'taskyon-map-widget-ready' }, '*')
  }
})

onBeforeUnmount(() => {
  window.removeEventListener('message', handleMessage)
})
</script>

<style scoped>
.taskyon-map-widget-page {
  height: 100vh;
  min-height: 100vh;
  padding: 0;
}

.taskyon-map-widget-page__error {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 16rem;
  padding: 1rem;
}
</style>
