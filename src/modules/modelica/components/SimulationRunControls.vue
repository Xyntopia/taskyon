<template>
  <div class="row items-center q-gutter-xs no-wrap">
    <template v-if="mode === 'simple'">
      <q-btn
        dense
        flat
        no-caps
        color="grey-7"
        :icon="matTune"
        :label="compactInfoLabel"
        style="max-width: 620px"
        class="ellipsis"
        @click="openDialog"
      />
    </template>

    <template v-else>
      <q-input
        v-model.number="t0Model"
        dense
        outlined
        type="number"
        label="t0"
        style="width: 90px"
      />
      <q-input
        v-model.number="tfModel"
        dense
        outlined
        type="number"
        label="tf"
        style="width: 90px"
      />
      <q-input
        v-model.number="dtModel"
        dense
        outlined
        type="number"
        label="dt"
        style="width: 90px"
      />
      <q-chip dense square color="grey-3" text-color="grey-8">
        {{ `N~ ${formatMaybe(predictedStepsEffective)}` }}
      </q-chip>
      <q-chip dense square color="grey-3" text-color="grey-8">
        {{ solverLabel || '-' }}
      </q-chip>
    </template>

    <q-btn
      dense
      flat
      color="secondary"
      :icon="matPlayArrow"
      label="Run"
      :disable="!canRun"
      :loading="running"
      @click="emit('run')"
    />

    <q-btn
      v-if="showPopupButton"
      dense
      flat
      color="secondary"
      :icon="matOpenInNew"
      label="Popup window"
      :disable="!canOpenPopup"
      @click="emit('open-popup')"
    />

    <q-btn v-if="running" flat dense color="negative" label="Stop" outline @click="emit('stop')" />

    <q-dialog v-model="openModel">
      <q-card style="min-width: 660px; max-width: 95vw">
        <q-card-section class="row items-center">
          <div class="text-subtitle1">Simulation Settings</div>
          <q-space />
          <q-btn v-close-popup flat dense :icon="matClose" />
        </q-card-section>
        <q-separator />
        <q-card-section class="q-gutter-sm">
          <div class="row q-col-gutter-sm">
            <div class="col-12 col-sm-4">
              <q-input v-model.number="t0Model" dense outlined type="number" label="t0" />
            </div>
            <div class="col-12 col-sm-4">
              <q-input v-model.number="tfModel" dense outlined type="number" label="tf" />
            </div>
            <div class="col-12 col-sm-4">
              <q-input v-model.number="dtModel" dense outlined type="number" label="dt" />
            </div>
          </div>

          <div class="text-caption text-grey-7">
            {{
              `Predicted steps: ${formatMaybe(predictedStepsEffective)} | Solver: ${solverLabel || '-'}`
            }}
          </div>
          <div v-if="hasResult" class="text-caption text-grey-7">
            {{ `Actual steps: ${formatMaybe(actualSteps)} | Events: ${formatMaybe(eventCount)}` }}
          </div>

          <q-expansion-item
            v-model="solverOptionsExpanded"
            dense
            expand-separator
            label="Solver Options"
          >
            <slot name="solver-options" />
          </q-expansion-item>
        </q-card-section>
        <q-separator />
        <q-card-actions align="right">
          <q-btn
            flat
            color="grey-7"
            label="Reset to Model Defaults"
            @click="emit('reset-from-model')"
          />
          <q-btn v-close-popup flat label="Close" />
        </q-card-actions>
      </q-card>
    </q-dialog>
  </div>
</template>

<script setup lang="ts">
import { matClose, matOpenInNew, matPlayArrow, matTune } from '@quasar/extras/material-icons'
import { computed, ref } from 'vue'

const props = withDefaults(
  defineProps<{
    mode?: 'simple' | 'full'
    solverLabel?: string
    predictedSteps?: number | null
    actualSteps?: number | null
    eventCount?: number | null
    hasResult?: boolean
    running?: boolean
    canRun?: boolean
    showPopupButton?: boolean
    canOpenPopup?: boolean
  }>(),
  {
    mode: 'simple',
    solverLabel: '',
    predictedSteps: null,
    actualSteps: null,
    eventCount: null,
    hasResult: false,
    running: false,
    canRun: true,
    showPopupButton: true,
    canOpenPopup: true,
  },
)

const emit = defineEmits<{
  (e: 'run'): void
  (e: 'open-popup'): void
  (e: 'stop'): void
  (e: 'reset-from-model'): void
}>()

const t0Model = defineModel<number>('t0', { default: 0 })
const tfModel = defineModel<number>('tf', { default: 5 })
const dtModel = defineModel<number>('dt', { default: 0.01 })
const openModel = defineModel<boolean>('open', { default: false })
const solverOptionsExpanded = ref(false)

const predictedStepsEffective = computed(() => {
  if (Number.isFinite(props.predictedSteps)) return Number(props.predictedSteps)
  const t0 = Number(t0Model.value)
  const tf = Number(tfModel.value)
  const dt = Number(dtModel.value)
  if (!Number.isFinite(t0) || !Number.isFinite(tf) || !Number.isFinite(dt) || dt <= 0 || tf < t0)
    return 0
  return Math.max(1, Math.floor((tf - t0) / dt) + 1)
})

const summaryLabel = computed(
  () =>
    `t0=${formatMaybe(t0Model.value)} tf=${formatMaybe(tfModel.value)} dt=${formatMaybe(dtModel.value)} N~${formatMaybe(predictedStepsEffective.value)} solver=${props.solverLabel || '-'}`,
)

const resultLabel = computed(
  () => `steps=${formatMaybe(props.actualSteps)} events=${formatMaybe(props.eventCount)}`,
)

const compactInfoLabel = computed(() =>
  props.hasResult ? `${summaryLabel.value} | ${resultLabel.value}` : summaryLabel.value,
)

function formatMaybe(value: unknown): string {
  const n = Number(value)
  if (!Number.isFinite(n)) return '-'
  if (Number.isInteger(n)) return String(n)
  return Number(n.toFixed(6)).toString()
}

function openDialog() {
  openModel.value = true
}
</script>
