<template>
  <q-dialog ref="dialogRef" @hide="onDialogHide">
    <q-card class="schedule-task-dialog">
      <q-card-section>
        <div class="text-h6">Schedule this task</div>
        <div class="text-caption">{{ defaultLabel ?? taskId }}</div>
      </q-card-section>
      <q-card-section class="column q-gutter-sm">
        <div class="row q-gutter-sm items-center">
          <q-input
            v-model.number="every"
            type="number"
            min="1"
            dense
            outlined
            label="Every"
            data-cy="schedule-every"
            style="max-width: 8rem"
          />
          <q-select
            v-model="unit"
            :options="unitOptions"
            dense
            outlined
            emit-value
            map-options
            label="Unit"
            data-cy="schedule-unit"
            style="min-width: 10rem"
          />
        </div>
        <q-toggle
          v-model="runWhenOpened"
          label="Run when Taskyon opens if overdue"
          data-cy="schedule-run-when-opened"
        />
        <div class="text-caption text-grey-7">Next run: {{ nextRunLabel }}</div>
      </q-card-section>
      <q-card-actions align="right">
        <q-btn flat label="Cancel" @click="onDialogCancel" />
        <q-btn
          color="primary"
          label="Schedule"
          :disable="!valid"
          data-cy="save-task-schedule"
          @click="save"
        />
      </q-card-actions>
    </q-card>
  </q-dialog>
</template>

<script setup lang="ts">
import { nextScheduleRun, type TaskScheduleCadence } from '@taskyon/taskyon'
import { useDialogPluginComponent, useQuasar } from 'quasar'
import { useTaskyonStore } from 'src/stores/taskyonState'
import { computed, ref } from 'vue'

const props = defineProps<{
  taskId: string
  defaultLabel?: string
}>()

const { dialogRef, onDialogCancel, onDialogHide, onDialogOK } = useDialogPluginComponent()
defineEmits([...useDialogPluginComponent.emits])

const $q = useQuasar()
const tystate = useTaskyonStore()
const every = ref(1)
const unit = ref<TaskScheduleCadence['unit']>('days')
const runWhenOpened = ref(true)
const unitOptions = [
  { label: 'Hours', value: 'hours' },
  { label: 'Days', value: 'days' },
  { label: 'Weeks', value: 'weeks' },
  { label: 'Months', value: 'months' },
]

const valid = computed(() => Number.isInteger(every.value) && every.value > 0)
const cadence = computed<TaskScheduleCadence>(() => ({ every: every.value, unit: unit.value }))
const nextRunLabel = computed(() =>
  new Date(nextScheduleRun(Date.now(), cadence.value)).toLocaleString(),
)

const save = async () => {
  if (!valid.value) return
  try {
    await tystate.scheduleTask({
      id: crypto.randomUUID(),
      taskId: props.taskId,
      ...(props.defaultLabel ? { label: props.defaultLabel } : {}),
      cadence: cadence.value,
      nextRunAt: new Date(nextScheduleRun(Date.now(), cadence.value)).toISOString(),
      runWhenOpened: runWhenOpened.value,
      enabled: true,
      createdAt: new Date().toISOString(),
    })
    onDialogOK()
  } catch (error) {
    $q.notify({
      type: 'negative',
      message: `Could not save the schedule: ${error instanceof Error ? error.message : String(error)}`,
    })
  }
}
</script>
