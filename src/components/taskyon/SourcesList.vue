<template>
  <div
    v-if="urlSources.length"
    class="row items-center q-gutter-xs text-caption text-grey-7 sources-row"
  >
    <span class="sources-label">Sources</span>

    <q-chip
      v-for="(ann, idx) in urlSources"
      :key="idx"
      dense
      outline
      clickable
      class="source-chip"
      @click="open(ann.url)"
    >
      {{ idx + 1 }}

      <q-tooltip anchor="top middle" self="bottom middle" max-width="320px">
        <div class="text-weight-medium q-mb-xs">
          {{ ann.title || ann.id || `Source ${idx + 1}` }}
        </div>

        <div class="text-caption text-grey-6">
          {{ domain(ann.url) }}
        </div>

        <div class="text-caption ellipsis text-grey-7 q-mt-xs">
          {{ ann.url }}
        </div>
      </q-tooltip>
    </q-chip>
  </div>
</template>

<script lang="ts" setup>
import type { Annotation } from '@taskyon/taskyon'
import { computed } from 'vue'

const props = defineProps<{
  sources: Annotation[]
}>()

const urlSources = computed(() =>
  props.sources.filter(
    (a): a is Annotation & { type: 'url'; url: string } =>
      a.type === 'url' && typeof a.url === 'string',
  ),
)

const open = (url: string) => {
  window.open(url, '_blank', 'noopener,noreferrer')
}

const domain = (url: string) => {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return url
  }
}
</script>

<style lang="css">
.sources-row {
  opacity: 0.75;
}

.sources-label {
  margin-right: 4px;
}

.source-chip {
  font-size: 11px;
  padding: 0 6px;
}

.source-chip:hover {
  opacity: 1;
}
</style>
