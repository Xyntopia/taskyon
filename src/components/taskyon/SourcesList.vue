<template>
  <template v-for="(ann, idx) in sources" :key="idx" class="text-caption text-grey">
    <div v-if="ann.type === 'url'">
      <a :href="ann.url" target="_blank" rel="noopener noreferrer" class="text-primary">
        {{ ann.title || ann.id || ann.url }}
      </a>
    </div>
  </template>
</template>

<script lang="ts" setup>
import { Annotation } from '@taskyon/taskyon'
defineProps<{
  sources: Annotation[]
}>()
</script>
