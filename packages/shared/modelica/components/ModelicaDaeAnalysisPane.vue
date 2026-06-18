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
        <q-item v-if="analysis.constraintBalance">
          <q-item-section>
            <q-item-label caption>Constraint balance (dynamic solve slice)</q-item-label>
            <q-item-label>
              Unknowns = {{ analysis.constraintBalance.unknownCountDynamic }}, equations =
              {{ analysis.constraintBalance.equationCountDynamic ?? 'n/a' }}, Δ(eq-unk) =
              {{ analysis.constraintBalance.equationMinusUnknown ?? 'n/a' }}
            </q-item-label>
            <q-item-label caption>
              Partition x/y/z/m/w =
              {{ analysis.constraintBalance.partitionCounts.x }}/{{
                analysis.constraintBalance.partitionCounts.y
              }}/{{ analysis.constraintBalance.partitionCounts.z }}/{{
                analysis.constraintBalance.partitionCounts.m
              }}/{{ analysis.constraintBalance.partitionCounts.w }}
            </q-item-label>
            <q-item-label caption>{{ analysis.constraintBalance.note }}</q-item-label>
          </q-item-section>
        </q-item>
      </q-list>
    </q-card-section>
    <q-separator />
    <q-card-section>
      <div class="text-caption text-grey-7 q-mb-sm">
        Structural forms are refreshed on demand when you open them.
      </div>
      <div class="row q-col-gutter-sm">
        <div v-for="artifact in artifacts" :key="artifact.key" class="col-12 col-sm-6 col-lg-4">
          <q-card flat bordered class="analysis-artifact-card">
            <q-card-section class="q-pa-sm">
              <div class="row items-center justify-between q-gutter-sm">
                <div class="col">
                  <div class="text-body2 text-weight-medium">{{ artifact.label }}</div>
                  <div class="text-caption text-grey-7">{{ artifact.description }}</div>
                </div>
                <q-spinner
                  v-if="loadingByArtifact[artifact.key]"
                  color="primary"
                  size="18px"
                  class="q-ml-sm"
                />
              </div>
              <div
                v-if="errorByArtifact[artifact.key]"
                class="text-caption text-negative q-mt-xs ellipsis-2-lines"
              >
                {{ errorByArtifact[artifact.key] }}
              </div>
              <div class="row justify-end q-mt-sm">
                <q-btn
                  dense
                  flat
                  color="primary"
                  :label="artifact.actionLabel"
                  :disable="loadingByArtifact[artifact.key]"
                  @click="
                    artifact.action === 'open'
                      ? emit('open-artifact', artifact.key)
                      : emit('download-artifact', artifact.key)
                  "
                />
              </div>
            </q-card-section>
          </q-card>
        </div>
      </div>
    </q-card-section>
  </q-card>
</template>

<script setup lang="ts">
export type ModelicaDaeAnalysis = {
  executionMode: string
  strategy: string
  counts: Array<{ label: string; value: number | string }>
  hints: string[]
  constraintBalance?: {
    unknownCountDynamic: number
    equationCountDynamic: number | null
    equationMinusUnknown: number | null
    note: string
    partitionCounts: {
      x: number
      y: number
      z: number
      m: number
      w: number
    }
  }
}

export type ModelicaAnalysisArtifactKey =
  | 'baseDae'
  | 'baseModelica'
  | 'flatModelica'
  | 'daeModelica'
  | 'daeJson'
  | 'ast'

type AnalysisArtifactCard = {
  key: ModelicaAnalysisArtifactKey
  label: string
  description: string
  action: 'open' | 'download'
  actionLabel: string
}

defineProps<{
  analysis: ModelicaDaeAnalysis
  loadingByArtifact: Partial<Record<ModelicaAnalysisArtifactKey, boolean>>
  errorByArtifact: Partial<Record<ModelicaAnalysisArtifactKey, string>>
}>()

const emit = defineEmits<{
  (e: 'open-artifact', value: ModelicaAnalysisArtifactKey): void
  (e: 'download-artifact', value: ModelicaAnalysisArtifactKey): void
}>()

const artifacts: AnalysisArtifactCard[] = [
  {
    key: 'baseDae',
    label: 'Base DAE',
    description: 'Rendered from the base_dae template.',
    action: 'open',
    actionLabel: 'Open',
  },
  {
    key: 'baseModelica',
    label: 'Base Modelica',
    description: 'Compiler structural view of the source model.',
    action: 'open',
    actionLabel: 'Open',
  },
  {
    key: 'flatModelica',
    label: 'Flat Modelica',
    description: 'Instantiated and flattened Modelica form.',
    action: 'open',
    actionLabel: 'Open',
  },
  {
    key: 'daeModelica',
    label: 'DAE Modelica',
    description: 'DAE-level textual form from rumoca.',
    action: 'open',
    actionLabel: 'Open',
  },
  {
    key: 'daeJson',
    label: 'DAE JSON',
    description: 'Structured DAE payload used for rendering. Download only.',
    action: 'download',
    actionLabel: 'Download',
  },
  {
    key: 'ast',
    label: 'AST',
    description: 'Parsed syntax tree for the current source. Download only.',
    action: 'download',
    actionLabel: 'Download',
  },
]
</script>

<style scoped>
.dae-analysis-metric {
  border: 1px solid rgba(0, 0, 0, 0.12);
}

.analysis-artifact-card {
  min-height: 110px;
}

.ellipsis-2-lines {
  display: -webkit-box;
  overflow: hidden;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
}
</style>
