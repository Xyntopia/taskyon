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
            :clickable="source.url !== undefined || source.route !== undefined"
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
        :clickable="source.url !== undefined || source.route !== undefined"
        @click="openSource(source)"
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
import { useRouter } from 'vue-router'
import ResponsiveMenuDialogBtn from '../ResponsiveMenuDialogBtn.vue'
import { storageFileManagerRoute, type StorageFileAnnotation } from './storageFileLinks'

const MAX_INLINE = 10

type SourceListItem = {
  key: string
  label: string
  detail: string
  url?: string
  route?: string
}

const props = defineProps<{
  sources: Annotation[]
}>()

const router = useRouter()
const dialogOpen = ref(false)

const urlSourceItems = (
  source: Extract<Annotation, { type: 'url' }>,
  index: number,
): SourceListItem[] =>
  source.url
    ? [
        {
          key: `url:${source.id ?? source.url}:${index}`,
          label: source.title || source.id || `Source ${index + 1}`,
          detail: source.url,
          url: source.url,
        },
      ]
    : []

const documentSourceItems = (
  source: Extract<Annotation, { type: 'document' }>,
  index: number,
): SourceListItem[] => {
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

const storageFileSourceItems = (source: StorageFileAnnotation, index: number): SourceListItem[] => {
  const label = source.name ?? source.id
  const metadata = [
    source.namespace,
    ...(source.name ? [source.id] : []),
    source.mediaType,
    source.size === undefined ? undefined : `${source.size} bytes`,
  ]
    .filter((detail): detail is string => detail !== undefined)
    .join(' · ')
  return [
    {
      key: `storage-file:${source.namespace}/${source.id}:${index}`,
      label,
      detail: metadata || 'Stored file',
      route: storageFileManagerRoute(source),
    },
  ]
}

const webSearchSourceItems = (
  source: Extract<Annotation, { type: 'web-search' }>,
  index: number,
): SourceListItem[] => {
  const queries = source.queries?.length ? source.queries.join(', ') : undefined
  const consulted = source.sources ?? []
  return [
    {
      key: `web-search:${index}`,
      label: 'Web search performed',
      detail: [
        queries ? `Queries: ${queries}` : undefined,
        consulted.length > 0
          ? `${consulted.length} sources consulted`
          : 'No source URLs reported',
      ]
        .filter(Boolean)
        .join(' · '),
    },
    ...consulted.map((entry, sourceIndex) => ({
      key: `web-search-source:${index}:${sourceIndex}`,
      label: entry.title ?? `Source ${sourceIndex + 1}`,
      detail: entry.url,
      url: entry.url,
    })),
  ]
}

const toSourceItems = (source: Annotation, index: number): SourceListItem[] => {
  switch (source.type) {
    case 'url':
      return urlSourceItems(source, index)
    case 'document':
      return documentSourceItems(source, index)
    case 'storage-file':
      return storageFileSourceItems(source, index)
    case 'web-search':
      return webSearchSourceItems(source, index)
    default:
      return []
  }
}

const sourceItems = computed<SourceListItem[]>(() =>
  props.sources.flatMap((source, index) => toSourceItems(source, index)),
)

const visibleSources = computed(() => sourceItems.value.slice(0, MAX_INLINE))

const overflowCount = computed(() => Math.max(0, sourceItems.value.length - MAX_INLINE))

const open = (url: string) => {
  window.open(url, '_blank', 'noopener,noreferrer')
}

const openSource = (source: SourceListItem) => {
  if (source.route) {
    void router.push(source.route)
    return
  }
  if (source.url) open(source.url)
}

const selectSource = (source: SourceListItem, close: () => void) => {
  if (!source.url && !source.route) return
  openSource(source)
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
