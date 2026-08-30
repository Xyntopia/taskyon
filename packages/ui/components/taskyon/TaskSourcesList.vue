<template>
  <div
    v-if="sourceItems.length"
    class="row items-center q-gutter-xs text-caption text-grey-7 sources-row"
  >
    <!-- Dialog / menu -->
    <ResponsiveMenuDialogBtn
      v-model="dialogOpen"
      label="Sources"
      auto-close
      size="sm"
      no-caps
      flat
      maximized
    >
      <template #default="{ close }">
        <q-list style="min-width: 320px; max-width: 420px" separator>
          <q-item
            v-for="source in sourceItems"
            :key="source.key"
            :clickable="source.url !== undefined"
            @click="selectSource(source, close)"
          >
            <q-item-section>
              <q-item-label class="text-weight-medium">
                {{ source.label }}
              </q-item-label>
              <q-item-label caption>
                {{ source.detail }}
              </q-item-label>
            </q-item-section>
          </q-item>
        </q-list>
      </template>
    </ResponsiveMenuDialogBtn>

    <div class="col row">
      <!-- Inline chips (limited) -->
      <q-chip
        v-for="(source, idx) in visibleSources"
        :key="source.key"
        dense
        size="sm"
        outline
        :clickable="source.url !== undefined"
        @click="source.url ? open(source.url) : undefined"
      >
        {{ idx + 1 }}
        <span class="q-pl-xs">
          {{ source.url ? domain(source.url) : source.label }}
        </span>

        <q-tooltip anchor="top middle" self="bottom middle" max-width="320px">
          <div class="text-weight-medium q-mb-xs">
            {{ source.label }}
          </div>
          <div class="text-caption text-grey-6">
            {{ source.detail }}
          </div>
        </q-tooltip>
      </q-chip>

      <!-- Overflow indicator -->
      <q-chip
        v-if="overflowCount > 0"
        dense
        outline
        clickable
        class="source-overflow"
        @click="() => (dialogOpen = true)"
      >
        +{{ overflowCount }}
      </q-chip>
    </div>
  </div>
</template>

<script lang="ts" setup>
import type { Annotation } from '@taskyon/taskyon/api'
import { computed, ref } from 'vue'
import ResponsiveMenuDialogBtn from '../ResponsiveMenuDialogBtn.vue'

const MAX_INLINE = 10

type SourceListItem = {
  key: string
  label: string
  detail: string
  url?: string
}

const props = defineProps<{
  sources: Annotation[]
}>()

const dialogOpen = ref(false)

const sourceItems = computed<SourceListItem[]>(() =>
  props.sources.flatMap((source, index) => {
    if (source.type === 'url' && source.url) {
      return [
        {
          key: `url:${source.id ?? source.url}:${index}`,
          label: source.title || source.id || `Source ${index + 1}`,
          detail: source.url,
          url: source.url,
        },
      ]
    }
    if (source.type === 'document') {
      const label =
        source.title ?? source.text ?? source.filename ?? source.id ?? `Document ${index + 1}`
      const metadata = [source.filename, source.mediaType, source.id]
        .filter((detail): detail is string => detail !== undefined)
        .join(' · ')
      return [
        {
          key: `document:${source.id ?? source.filename ?? label}:${index}`,
          label,
          detail: metadata || source.content || 'Document source',
        },
      ]
    }
    return []
  }),
)

const visibleSources = computed(() => sourceItems.value.slice(0, MAX_INLINE))

const overflowCount = computed(() => Math.max(0, sourceItems.value.length - MAX_INLINE))

const open = (url: string) => {
  window.open(url, '_blank', 'noopener,noreferrer')
}

const selectSource = (source: SourceListItem, close: () => void) => {
  if (!source.url) return
  open(source.url)
  close()
}

const domain = (url: string) => {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return url
  }
}
</script>
