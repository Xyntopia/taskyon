<template>
  <div
    v-if="urlSources.length"
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
    </ResponsiveMenuDialogBtn>

    <div class="col row">
      <!-- Inline chips (limited) -->
      <q-chip
        v-for="(ann, idx) in visibleSources"
        :key="idx"
        dense
        size="sm"
        outline
        clickable
        @click="open(ann.url)"
      >
        {{ idx + 1 }}
        <span class="q-pl-xs">
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
        class="source-overflow"
        @click="() => (dialogOpen = true)"
      >
        +{{ overflowCount }}
      </q-chip>
    </div>
  </div>
</template>

<script lang="ts" setup>
import ResponsiveMenuDialogBtn from '@taskyon/shared/components/ResponsiveMenuDialogBtn.vue'
import type { Annotation } from '@taskyon/taskyon'
import { computed, ref } from 'vue'

const MAX_INLINE = 10

const props = defineProps<{
  sources: Annotation[]
}>()

const dialogOpen = ref(false)

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
