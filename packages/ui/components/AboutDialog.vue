<template>
  <q-dialog v-model="open" @show="loadMetadata">
    <q-card class="about-dialog" :data-cy="props.dataCy">
      <header class="about-dialog__header">
        <h2>About {{ props.appName }}</h2>
        <q-btn
          flat
          round
          dense
          :icon="mdiClose"
          :aria-label="`Close About ${props.appName}`"
          @click="open = false"
        />
      </header>

      <q-card-section>
        {{ props.description }}
      </q-card-section>

      <q-card-actions v-if="$slots.actions">
        <slot name="actions" />
      </q-card-actions>

      <q-card-section class="about-dialog__build">
        <h3>Build</h3>
        <dl>
          <div>
            <dt>Commit hash:</dt>
            <dd data-cy="taskyon-build-commit">{{ buildMetadata.commit }}</dd>
          </div>
          <div>
            <dt>Build date (UTC):</dt>
            <dd>{{ buildMetadata.publishDate }}</dd>
          </div>
          <div>
            <dt>Build date (local):</dt>
            <dd data-cy="taskyon-build-time">{{ formattedBuildTime }}</dd>
          </div>
        </dl>
      </q-card-section>

      <q-card-section class="about-dialog__environment">
        <details>
          <summary>Runtime environment</summary>
          <dl>
            <div v-for="[name, value] of Object.entries(environmentInfo)" :key="name">
              <dt>{{ name }}</dt>
              <dd>{{ formatEnvironmentValue(value) }}</dd>
            </div>
          </dl>
        </details>
      </q-card-section>

      <q-card-section v-if="$slots.legal" class="about-dialog__attribution">
        <slot name="legal" />
      </q-card-section>
    </q-card>
  </q-dialog>
</template>

<script setup lang="ts">
import { mdiClose } from '@quasar/extras/mdi-v6'
import { loadBuildMetadata, UNKNOWN_BUILD_METADATA } from '@taskyon/common/modules/buildMetadata'
import { getEnvironmentInfo } from '@taskyon/common/modules/utils'
import { computed, ref } from 'vue'

defineSlots<{
  actions?: () => unknown
  legal?: () => unknown
}>()

const props = withDefaults(
  defineProps<{
    appName: string
    description: string
    dataCy?: string
  }>(),
  {
    dataCy: 'about-dialog',
  },
)

const open = defineModel<boolean>({ required: true })
const buildMetadata = ref(UNKNOWN_BUILD_METADATA)
const environmentInfo = computed(() => getEnvironmentInfo(buildMetadata.value))
const formattedBuildTime = computed(() => {
  const date = new Date(buildMetadata.value.publishDate)
  return Number.isNaN(date.getTime()) ? buildMetadata.value.publishDate : date.toLocaleString()
})
let buildMetadataLoaded = false
let pendingBuildMetadata: Promise<void> | undefined

function loadMetadata() {
  if (buildMetadataLoaded || pendingBuildMetadata) return

  pendingBuildMetadata = loadBuildMetadata(fetch)
    .then((metadata) => {
      buildMetadata.value = metadata
      buildMetadataLoaded = true
    })
    .catch((error: unknown) => {
      console.warn('Unable to load build metadata:', error)
    })
    .finally(() => {
      pendingBuildMetadata = undefined
    })
}

const formatEnvironmentValue = (value: unknown): string => {
  if (typeof value === 'string') return value
  try {
    return JSON.stringify(value) ?? 'unknown'
  } catch {
    return String(value)
  }
}
</script>

<style scoped>
.about-dialog {
  width: min(680px, calc(100vw - 32px));
  max-width: 680px;
  max-height: min(820px, calc(100vh - 32px));
  overflow: auto;
}

.about-dialog__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 20px 24px 8px;
}

.about-dialog__header h2,
.about-dialog__build h3,
.about-dialog__attribution p {
  margin: 0;
}

.about-dialog__header h2 {
  font-size: 1.5rem;
}

.about-dialog__build h3 {
  margin-bottom: 10px;
  font-size: 0.8rem;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.about-dialog dl {
  display: grid;
  gap: 8px;
  margin: 0;
}

.about-dialog dl > div {
  display: grid;
  grid-template-columns: minmax(100px, 0.35fr) minmax(0, 1fr);
  gap: 12px;
}

.about-dialog dt {
  color: var(--secondary-text-color, currentColor);
}

.about-dialog dd {
  min-width: 0;
  margin: 0;
  overflow-wrap: anywhere;
}

.about-dialog__build dd {
  font-family: monospace;
}

.about-dialog__environment {
  font-size: 0.75rem;
}

.about-dialog__environment summary {
  cursor: pointer;
}

.about-dialog__environment dl {
  margin-top: 12px;
}

.about-dialog__attribution {
  display: grid;
  gap: 10px;
  font-size: 0.8rem;
}
</style>
