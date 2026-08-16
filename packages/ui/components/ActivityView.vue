<template>
  <div class="activity-view column no-wrap">
    <div v-if="state.running.length" class="activity-section">
      <div class="text-caption text-uppercase q-mb-xs">Running</div>
      <ActivityRow v-for="entry in state.running" :key="entry.id" :entry="entry" />
    </div>
    <div v-if="state.recent.length" class="activity-section">
      <div class="row items-center q-mb-xs">
        <div class="text-caption text-uppercase">Recent</div>
        <q-space />
        <q-btn
          v-if="state.status === 'error'"
          flat
          dense
          no-caps
          label="Acknowledge"
          @click="emit('acknowledge')"
        />
      </div>
      <ActivityRow v-for="entry in state.recent" :key="entry.id" :entry="entry" />
    </div>
    <div v-if="!state.running.length && !state.recent.length" class="q-pa-md text-grey-7">
      No recent activity.
    </div>
  </div>
</template>

<script setup lang="ts">
import type { ActivityState } from '@taskyon/common/modules/activity'
import ActivityRow from './ActivityRow.vue'

defineProps<{ state: ActivityState }>()
const emit = defineEmits<{ acknowledge: [] }>()
</script>

<style scoped lang="sass">
.activity-view
  min-width: 300px
  max-height: 440px
  overflow: auto

.activity-section
  padding: 12px
</style>
