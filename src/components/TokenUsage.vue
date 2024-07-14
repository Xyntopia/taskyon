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
            {{ task.debugging.estimatedTokens?.functionTokens }}
            (estimated)
          </td>
        </tr>
        <tr>
          <td>Thread:</td>
          <td class="text-right">
            {{
              (task.debugging.estimatedTokens?.promptTokens || 0) -
              (task.debugging.estimatedTokens?.functionTokens || 0)
            }}
            (estimated)
          </td>
        </tr>
        <tr>
          <td class="text-left">Prompt (Entire Thread):</td>
          <td v-if="task.debugging?.promptTokens" class="text-right">
            {{ task.debugging?.promptTokens }}
          </td>
          <td v-else class="text-right">
            {{ task.debugging.estimatedTokens?.promptTokens }}
            (estimated)
          </td>
        </tr>
        <tr>
          <td class="text-left">Completion/Result:</td>
          <td v-if="task.debugging?.resultTokens" class="text-right">
            {{ task.debugging?.resultTokens }}
          </td>
          <td v-else class="text-right">
            {{ task.debugging?.resultTokens }}
          </td>
        </tr>
        <tr>
          <td class="text-left">Total tokens used for task:</td>
          <td v-if="task.debugging?.taskTokens" class="text-right">
            ={{ task.debugging?.taskTokens }}
          </td>
          <td v-else class="text-right">
            ={{
              (task.debugging.estimatedTokens?.promptTokens || 0) +
              (task.debugging.estimatedTokens?.resultTokens || 0)
            }}
            (estimated)
          </td>
        </tr>
        <tr v-if="task.debugging?.taskCosts != undefined">
          <td class="text-left">Costs:</td>
          <td class="text-right">
            =
            {{ Math.round(task.debugging?.taskCosts * 1e6).toLocaleString() }}
            μ$ (exact, ={{ Math.round(0.01 / task.debugging?.taskCosts) }}
            messages to reach $0.01)
          </td>
        </tr>
      </tbody>
    </q-markup-table>
  </div>
</template>

<script setup lang="ts">
import { PropType } from 'vue';
import { TaskNode } from 'src/modules/taskyon/types';
import '@quasar/quasar-ui-qmarkdown/dist/index.css';

defineProps({
  task: {
    type: Object as PropType<TaskNode>,
    required: true,
  },
});
</script>
