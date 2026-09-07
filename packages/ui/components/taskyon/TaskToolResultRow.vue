<template>
  <article
    ref="element"
    class="task-chat-message functioncall q-px-sm q-py-xs"
    :data-task-id="task.id"
  >
    <button class="tool-result-toggle" :aria-expanded="expanded" @click="toggle">
      <q-icon :name="expanded ? mdiChevronDown : mdiChevronRight" />
      <span>{{ task.content.type === 'functioncall' ? task.content.data.name : 'Tool' }}</span>
      <span class="ellipsis text-caption" :class="hasError ? 'text-negative' : 'text-grey'">{{
        preview
      }}</span>
      <span v-if="results.length > 1" class="text-caption">+{{ results.length - 1 }}</span>
    </button>
    <div v-if="error" role="status" class="text-caption">
      Result unavailable. <q-btn flat dense no-caps label="Retry" @click="load" />
    </div>
    <div v-if="expanded" class="q-pl-md q-pt-xs">
      <TaskContentView :task="task" />
      <TaskContentView v-for="result in results" :key="result.id" :task="result" />
      <span v-if="!results.length" class="text-caption">{{
        loading ? 'Loading…' : 'No result available yet.'
      }}</span>
    </div>
  </article>
</template>

<script setup lang="ts">
import { mdiChevronDown, mdiChevronRight } from '@quasar/extras/mdi-v6'
import { serializeObject } from '@taskyon/common/modules/serializeObject'
import type { TaskNode } from '@taskyon/taskyon/api'
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import TaskContentView from './TaskContentView.vue'

const props = defineProps<{
  task: TaskNode
  revision: number
  selectionId: string
  loadResults: (id: string, priority: boolean) => Promise<TaskNode[]>
}>()
const element = ref<HTMLElement>()
const expanded = ref(false)
const results = ref<TaskNode[]>([])
const loading = ref(false)
const error = ref(false)
let visible = false
let disposed = false
let observer: IntersectionObserver | undefined
let reload = false
const hasError = computed(() => results.value.some((task) => task.content.type === 'error'))
const preview = computed(() => {
  const result = results.value.find((task) => task.content.type === 'error') ?? results.value[0]
  return result
    ? serializeObject(result.content.data, {
        maxDepth: 2,
        maxArrayLength: 3,
        maxObjectKeys: 4,
        maxStringLength: 120,
        format: 'yaml',
        includeTruncationMeta: false,
      })
        .replace(/\s+/g, ' ')
        .slice(0, 160)
    : loading.value
      ? 'Loading…'
      : ''
})
const load = async () => {
  if (disposed) return
  if (loading.value) {
    reload = true
    return
  }
  loading.value = true
  error.value = false
  const selectedId = props.selectionId
  try {
    const loaded = await props.loadResults(props.task.id, expanded.value)
    if (!disposed && selectedId === props.selectionId) results.value = loaded
  } catch {
    if (!disposed) error.value = true
  } finally {
    loading.value = false
    if (reload && !error.value) {
      reload = false
      void load()
    }
  }
}
const toggle = () => {
  expanded.value = !expanded.value
  if (expanded.value && !error.value) void load()
}
watch(
  () => props.selectionId,
  () => {
    results.value = []
    error.value = false
    if (visible || expanded.value) void load()
  },
)
watch(
  () => props.revision,
  () => {
    if (visible && !error.value) void load()
  },
)
onMounted(() => {
  observer = new IntersectionObserver(
    (entries) => {
      visible = entries.some((entry) => entry.isIntersecting)
      if (visible && !error.value) void load()
    },
    { rootMargin: '100% 0px' },
  )
  if (element.value) observer.observe(element.value)
})
onBeforeUnmount(() => {
  disposed = true
  observer?.disconnect()
})
</script>

<style scoped>
.tool-result-toggle {
  display: flex;
  align-items: center;
  gap: 0.35rem;
  width: 100%;
  border: 0;
  padding: 0;
  background: transparent;
  color: inherit;
  text-align: left;
  cursor: pointer;
  font: inherit;
}
.task-chat-message {
  width: min(100%, 48rem);
  min-width: 0;
}
</style>
