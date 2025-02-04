<template>
  <div>
    <q-markup-table
      dense
      flat
      :bordered="false"
      separator="horizontal"
      style="background-color: inherit; color: inherit"
    >
      Token Usage
      <tbody>
        <tr>
          <td class="text-left">Functions:</td>
          <td class="text-right">
            {{ taskMeta.estimatedTokens?.functionTokens }}
            (estimated)
          </td>
        </tr>
        <tr>
          <td>Thread:</td>
          <td class="text-right">
            {{
              (taskMeta.estimatedTokens?.promptTokens || 0) -
              (taskMeta.estimatedTokens?.functionTokens || 0)
            }}
            (estimated)
          </td>
        </tr>
        <tr>
          <td class="text-left">Prompt (Entire Thread):</td>
          <td v-if="taskMeta.promptTokens" class="text-right">
            {{ taskMeta.promptTokens }}
          </td>
          <td v-else class="text-right">
            {{ taskMeta.estimatedTokens?.promptTokens }}
            (estimated)
          </td>
        </tr>
        <tr>
          <td class="text-left">Completion/Result:</td>
          <td v-if="taskMeta.resultTokens" class="text-right">
            {{ taskMeta.resultTokens }}
          </td>
          <td v-else class="text-right">
            {{ taskMeta.resultTokens }}
          </td>
        </tr>
        <tr>
          <td class="text-left">Total tokens used for task:</td>
          <td v-if="taskMeta.taskTokens" class="text-right">={{ taskMeta.taskTokens }}</td>
          <td v-else class="text-right">
            ={{
              (taskMeta.estimatedTokens?.promptTokens || 0) +
              (taskMeta.estimatedTokens?.resultTokens || 0)
            }}
            (estimated)
          </td>
        </tr>
        <tr v-if="taskMeta.taskCosts != undefined">
          <td class="text-left">Costs:</td>
          <td class="text-right">
            =
            {{ Math.round(taskMeta.taskCosts * 1e6).toLocaleString() }}
            μ$ (exact, ={{ Math.round(0.01 / taskMeta.taskCosts) }}
            messages to reach $0.01)
          </td>
        </tr>
      </tbody>
    </q-markup-table>
  </div>
</template>

<script setup lang="ts">
import type { PropType } from 'vue'
import type { TaskNodeMeta } from 'src/modules/taskyon/types'
import '@quasar/quasar-ui-qmarkdown/dist/index.css'

defineProps({
  taskMeta: {
    type: Object as PropType<TaskNodeMeta>,
    required: true,
  },
})
</script>
