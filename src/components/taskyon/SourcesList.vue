<template>
  <div
    v-if="urlSources.length"
    class="row items-center q-gutter-xs text-caption text-grey-7 sources-row"
  >
    <!-- Label / dialog trigger -->
    <span class="sources-label cursor-pointer" @click="dialogOpen = true"> Sources </span>

    <!-- Inline chips (limited) -->
    <q-chip
      v-for="(ann, idx) in visibleSources"
      :key="idx"
      dense
      outline
      clickable
      class="source-chip"
      @click="open(ann.url)"
    >
      {{ idx + 1 }}
      <span class="source-domain">
        {{ domain(ann.url) }}
      </span>

      <q-tooltip anchor="top middle" self="bottom middle" max-width="320px">
        <div class="text-weight-medium q-mb-xs">
          {{ ann.title || ann.id || `Source ${idx + 1}` }}
        </div>
        <div class="text-caption text-grey-6">
          {{ ann.url }}
        </div>
      </q-tooltip>
    </q-chip>

    <!-- Overflow indicator -->
    <q-chip
      v-if="overflowCount > 0"
      dense
      outline
      clickable
      class="source-chip source-overflow"
      @click="dialogOpen = true"
    >
      +{{ overflowCount }}
    </q-chip>

    <!-- Dialog / menu -->
    <ResponsiveMenuDialog v-model="dialogOpen" :auto-close="true" :target="dialogTarget">
      <template #default="{ close }">
        <q-list dense style="min-width: 320px; max-width: 420px">
          <q-item
            v-for="(ann, idx) in urlSources"
            :key="idx"
            clickable
            @click="
              () => {
                ;(open(ann.url), close())
              }
            "
          >
            <q-item-section>
              <q-item-label class="text-weight-medium">
                {{ ann.title || ann.id || `Source ${idx + 1}` }}
              </q-item-label>
              <q-item-label caption>
                {{ ann.url }}
              </q-item-label>
            </q-item-section>
          </q-item>
        </q-list>
      </template>
    </ResponsiveMenuDialog>
  </div>
</template>

<script lang="ts" setup>
import { computed, ref } from 'vue'
import type { Annotation } from '@taskyon/taskyon'
import ResponsiveMenuDialog from '../ResponsiveMenuDialog.vue'

const MAX_INLINE = 5

const props = defineProps<{
  sources: Annotation[]
}>()

const dialogOpen = ref(false)
const dialogTarget = ref<HTMLElement | undefined>(undefined)

const urlSources = computed(() =>
  props.sources.filter(
    (a): a is Annotation & { type: 'url'; url: string } =>
      a.type === 'url' && typeof a.url === 'string',
  ),
)

const visibleSources = computed(() => urlSources.value.slice(0, MAX_INLINE))

const overflowCount = computed(() => Math.max(0, urlSources.value.length - MAX_INLINE))

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
  flex-wrap: wrap;
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

.source-domain {
  margin-left: 4px;
  font-size: 10px;
  opacity: 0.6;
}
</style>
