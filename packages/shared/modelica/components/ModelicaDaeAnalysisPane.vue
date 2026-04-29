<template>
  <q-card flat>
    <q-card-section>
      <div class="row q-col-gutter-sm">
        <div v-for="item in analysis.counts" :key="item.label" class="col-6 col-md-3">
          <q-item dense class="dae-analysis-metric">
            <q-item-section>
              <q-item-label caption>{{ item.label }}</q-item-label>
              <q-item-label class="text-weight-medium">{{ item.value }}</q-item-label>
            </q-item-section>
          </q-item>
        </div>
      </div>
    </q-card-section>
    <q-separator />
    <q-card-section>
      <q-list dense separator>
        <q-item>
          <q-item-section>
            <q-item-label caption>Execution mode</q-item-label>
            <q-item-label>{{ analysis.executionMode }}</q-item-label>
          </q-item-section>
        </q-item>
        <q-item>
          <q-item-section>
            <q-item-label caption>Solving strategy</q-item-label>
            <q-item-label>{{ analysis.strategy }}</q-item-label>
          </q-item-section>
        </q-item>
        <q-item v-for="hint in analysis.hints" :key="hint">
          <q-item-section>
            <q-item-label>{{ hint }}</q-item-label>
          </q-item-section>
        </q-item>
      </q-list>
    </q-card-section>
  </q-card>
</template>

<script setup lang="ts">
export type ModelicaDaeAnalysis = {
  executionMode: string
  strategy: string
  counts: Array<{ label: string; value: number | string }>
  hints: string[]
}

defineProps<{
  analysis: ModelicaDaeAnalysis
}>()
</script>

<style scoped>
.dae-analysis-metric {
  border: 1px solid rgba(0, 0, 0, 0.12);
}
</style>
