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
      <tbody v-if="task.debugging?.aiResponse?.usage">
        <tr>
          <td class="text-left">Prompt (estimated Ts for functions):</td>
          <td class="text-right">
            +
            {{ task.debugging?.aiResponse?.usage.prompt_tokens }}
            (
            {{
              estimateChatTokens(task, state.chatState).functionTokens * 0.8
            }})
          </td>
        </tr>
        <tr>
          <td class="text-left">Completion:</td>
          <td class="text-right">
            +
            {{ task.debugging?.aiResponse?.usage.completion_tokens }}
          </td>
        </tr>
        <tr>
          <td class="text-left">Total:</td>
          <td class="text-right">
            =
            {{ task.debugging?.aiResponse?.usage.total_tokens }} (exact)
          </td>
        </tr>
        <tr v-if="task.debugging?.inference_costs != undefined">
          <td class="text-left">Costs:</td>
          <td class="text-right">
            =
            {{
              Math.round(task.debugging?.inference_costs * 1e6).toLocaleString()
            }}
            μ$ (exact, ={{ Math.round(0.01 / task.debugging?.inference_costs) }}
            messages to reach $0.01)
          </td>
        </tr>
      </tbody>
      <tbody v-else>
        <tr>
          <td class="text-left">Functions (estimated):</td>
          <td class="text-right">
            +
            {{ estimateChatTokens(task, state.chatState).functionTokens }}
          </td>
        </tr>
        <tr>
          <td class="text-left">Prompt (estimated):</td>
          <td class="text-right">
            +
            {{ estimateChatTokens(task, state.chatState).promptTokens }}
          </td>
        </tr>
        <tr>
          <td class="text-left">Conversation (estimated):</td>
          <td class="text-right">
            +
            {{ estimateChatTokens(task, state.chatState).chatTokens }}
          </td>
        </tr>
        <tr>
          <td class="text-left">Total:</td>
          <td v-if="task.debugging?.usedTokens" class="text-right">
            = {{ task.debugging?.usedTokens }} (exact)
          </td>
          <td v-else class="text-right">
            =
            {{ estimateChatTokens(task, state.chatState).total }}
            (estimated)
          </td>
        </tr>
      </tbody>
    </q-markup-table>
  </div>
</template>

<script setup lang="ts">
import { defineProps, PropType } from 'vue';
import { estimateChatTokens } from 'src/modules/chat';
import { LLMTask } from 'src/modules/types';
import '@quasar/quasar-ui-qmarkdown/dist/index.css';
import { useTaskyonStore } from 'stores/taskyonState';

defineProps({
  task: {
    type: Object as PropType<LLMTask>,
    required: true,
  },
});

const state = useTaskyonStore();
</script>
