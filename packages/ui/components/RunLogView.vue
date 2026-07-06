<template>
  <div class="row no-wrap">
    <q-scroll-area
      ref="scrollRef"
      :style="{ height: scrollHeight }"
      class="col rounded-borders log-surface"
    >
      <q-list dense separator>
        <q-item v-for="entry in logs" :key="entry.id">
          <q-item-section>
            <q-item-label caption class="text-mono">
              [{{ formatTimestamp(entry.atMs) }}] [{{ entry.source }}] [{{ entry.level }}]
            </q-item-label>
            <q-item-label :class="levelClass(entry.level)">{{ entry.message }}</q-item-label>
            <q-item-label v-if="formatData(entry.data)" caption class="text-mono text-grey-8">
              {{ formatData(entry.data) }}
            </q-item-label>
          </q-item-section>
        </q-item>
      </q-list>
    </q-scroll-area>

    <div class="column q-ml-xs q-gutter-xs justify-start items-center log-actions">
      <q-btn dense flat icon="content_copy" color="primary" @click="copyAllLogs">
        <q-tooltip>Copy all logs</q-tooltip>
      </q-btn>
      <q-btn dense flat icon="delete_sweep" color="negative" @click="clearAllLogs">
        <q-tooltip>Clear logs</q-tooltip>
      </q-btn>
    </div>
  </div>
</template>

<script setup lang="ts">
import { copyToClipboard } from '@taskyon/common/modules/utils'
import { useSharedRunLogs, type UnifiedLogEntry } from '@taskyon/common/modules/runLogs'
import { useQuasar } from 'quasar'
import { computed, nextTick, ref, watch } from 'vue'

const props = defineProps<{ logs: UnifiedLogEntry[] }>()
const { clearLogs } = useSharedRunLogs()
const $q = useQuasar()
const scrollRef = ref<{
  setScrollPercentage: (
    axis: 'vertical' | 'horizontal',
    percentage: number,
    duration?: number,
  ) => void
} | null>(null)

const logs = computed(() => props.logs)
const scrollHeight = computed(() => '220px')

const formatTimestamp = (atMs: number): string =>
  new Date(atMs).toISOString().replace('T', ' ').slice(0, 19)

const formatData = (value: unknown): string => {
  if (value == null) return ''
  if (typeof value === 'string') return value
  try {
    const asText = JSON.stringify(value)
    return asText.length > 380 ? `${asText.slice(0, 377)}...` : asText
  } catch {
    return Object.prototype.toString.call(value)
  }
}

const levelClass = (level: UnifiedLogEntry['level']): string => {
  if (level === 'error') return 'text-negative'
  if (level === 'warn') return 'text-warning'
  return 'text-info'
}

const copyText = computed(() =>
  logs.value
    .map((entry) => {
      const data = formatData(entry.data)
      const base = `[${formatTimestamp(entry.atMs)}] [${entry.source}] [${entry.level}] ${entry.message}`
      return data ? `${base}\n  ${data}` : base
    })
    .join('\n'),
)

const copyAllLogs = () => {
  try {
    void copyToClipboard(copyText.value)
    $q.notify({ type: 'positive', message: 'Logs copied to clipboard.' })
  } catch (error: unknown) {
    $q.notify({
      type: 'negative',
      message: `Could not copy logs: ${Object.prototype.toString.call(error)}`,
    })
  }
}

const clearAllLogs = () => {
  clearLogs()
  $q.notify({ type: 'positive', message: 'Logs cleared.' })
}

watch(
  () => logs.value.length,
  async () => {
    await nextTick()
    scrollRef.value?.setScrollPercentage('vertical', 1)
  },
  { immediate: true },
)
</script>

<style scoped>
.log-actions {
  width: 36px;
}

.log-surface {
  background: transparent;
  border: 1px solid var(--q-info);
}
</style>
