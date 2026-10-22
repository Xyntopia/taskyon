<template>
  <q-card flat bordered class="q-pa-md">
    <div class="text-subtitle1">Scheduled tasks</div>
    <div class="text-caption text-grey-7 q-mb-sm">
      Saved workflows run on their schedule while Taskyon is open. An overdue schedule marked "run
      when opened" starts on the first device that becomes active again.
    </div>
    <q-list v-if="tystate.taskSchedules.length > 0" separator>
      <q-item v-for="schedule in tystate.taskSchedules" :key="schedule.id">
        <q-item-section>
          <q-item-label>{{ schedule.label ?? schedule.taskId }}</q-item-label>
          <q-item-label caption>
            Every {{ schedule.cadence.every }} {{ schedule.cadence.unit }} · next
            {{ new Date(schedule.nextRunAt).toLocaleString() }}
            <span v-if="schedule.lastRunAt">
              · last {{ new Date(schedule.lastRunAt).toLocaleString() }}
            </span>
          </q-item-label>
        </q-item-section>
        <q-item-section side>
          <q-toggle
            :model-value="schedule.enabled"
            @update:model-value="(enabled) => tystate.setTaskScheduleEnabled(schedule, enabled === true)"
          />
        </q-item-section>
        <q-item-section side>
          <q-btn
            flat
            round
            dense
            :icon="matDelete"
            aria-label="delete schedule"
            @click="tystate.deleteTaskSchedule(schedule.id)"
          />
        </q-item-section>
      </q-item>
    </q-list>
    <div v-else class="text-caption">No scheduled tasks.</div>
    <q-btn class="q-mt-sm" flat dense label="Refresh" @click="tystate.refreshTaskSchedules()" />
  </q-card>
</template>

<script setup lang="ts">
import { matDelete } from '@quasar/extras/material-icons'
import { useTaskyonStore } from 'src/stores/taskyonState'
import { onMounted } from 'vue'

const tystate = useTaskyonStore()

onMounted(() => void tystate.refreshTaskSchedules())
</script>
