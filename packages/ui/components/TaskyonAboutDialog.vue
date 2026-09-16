<template>
  <q-dialog :model-value="modelValue" @update:model-value="$emit('update:modelValue', $event)">
    <q-card class="taskyon-about" data-cy="taskyon-about">
      <header class="taskyon-about__header">
        <h2>About Taskyon</h2>
        <q-btn
          flat
          round
          dense
          :icon="mdiClose"
          aria-label="Close About Taskyon"
          @click="$emit('update:modelValue', false)"
        />
      </header>

      <q-card-section>
        Taskyon is a local-first AI platform for personalized task management and seamless web
        integration. It ensures data security with local processing while offering powerful tools
        like task trees, function execution, and sandboxing. Learn more at taskyon.space.
      </q-card-section>

      <q-card-section class="taskyon-about__build">
        <h3>Build</h3>
        <dl>
          <div>
            <dt>Commit</dt>
            <dd data-cy="taskyon-build-commit">{{ commitHash }}</dd>
          </div>
          <div>
            <dt>Built</dt>
            <dd data-cy="taskyon-build-time">{{ formattedBuildTime }}</dd>
          </div>
        </dl>
      </q-card-section>

      <q-card-actions v-if="$slots.actions">
        <slot name="actions" />
      </q-card-actions>

      <q-card-section class="taskyon-about__environment">
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

      <q-card-section class="taskyon-about__attribution">
        <p>
          This application uses <strong>Rumoca</strong>, a Modelica compiler written in Rust
          compiled to WebAssembly. Rumoca is licensed under the Apache-2.0 License.
        </p>
        <p>
          Rumoca — “A Modelica compiler written in Rust” (© 2024–2025 Condie, Woodbury, Goppert,
          Andersson & contributors). See
          <a href="https://github.com/condie-etc/rumoca" target="_blank">the Rumoca repository</a>
          and the included Apache-2.0 license for details.
        </p>
      </q-card-section>
    </q-card>
  </q-dialog>
</template>

<script setup lang="ts">
import { mdiClose } from '@quasar/extras/mdi-v6'
import { getEnvironmentInfo } from '@taskyon/common/modules/utils'
import { computed } from 'vue'

const props = defineProps<{
  modelValue: boolean
  commitHash: string
  buildTime: string
}>()

defineEmits<{
  'update:modelValue': [value: boolean]
}>()

const formattedBuildTime = computed(() => {
  const date = new Date(props.buildTime)
  return Number.isNaN(date.getTime()) ? props.buildTime : date.toLocaleString()
})
const environmentInfo = computed(() =>
  getEnvironmentInfo({ commit: props.commitHash, publishDate: props.buildTime }),
)

const formatEnvironmentValue = (value: unknown) => {
  if (typeof value === 'string') return value
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}
</script>

<style scoped>
.taskyon-about {
  width: min(680px, calc(100vw - 32px));
  max-width: 680px;
  max-height: min(820px, calc(100vh - 32px));
  overflow: auto;
}

.taskyon-about__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 20px 24px 8px;
}

.taskyon-about__header h2,
.taskyon-about__build h3,
.taskyon-about__attribution p {
  margin: 0;
}

.taskyon-about__header h2 {
  font-size: 1.5rem;
}

.taskyon-about__build h3 {
  margin-bottom: 10px;
  font-size: 0.8rem;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.taskyon-about dl {
  display: grid;
  gap: 8px;
  margin: 0;
}

.taskyon-about dl > div {
  display: grid;
  grid-template-columns: minmax(100px, 0.35fr) minmax(0, 1fr);
  gap: 12px;
}

.taskyon-about dt {
  color: var(--secondary-text-color, currentColor);
}

.taskyon-about dd {
  min-width: 0;
  margin: 0;
  overflow-wrap: anywhere;
}

.taskyon-about__build dd {
  font-family: monospace;
}

.taskyon-about__environment {
  font-size: 0.75rem;
}

.taskyon-about__environment summary {
  cursor: pointer;
}

.taskyon-about__environment dl {
  margin-top: 12px;
}

.taskyon-about__attribution {
  display: grid;
  gap: 10px;
  font-size: 0.8rem;
}
</style>
