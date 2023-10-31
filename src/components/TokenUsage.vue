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
      <tbody v-if="message.debugging?.aiResponse?.usage">
        <tr>
          <td class="text-left">Prompt (estimated Ts for functions):</td>
          <td class="text-right">
            +
            {{ message.debugging?.aiResponse?.usage.prompt_tokens }}
            (
            {{
              estimateChatTokens(message, state.chatState).functionTokens * 0.8
            }})
          </td>
        </tr>
        <tr>
          <td class="text-left">Completion:</td>
          <td class="text-right">
            +
            {{ message.debugging?.aiResponse?.usage.completion_tokens }}
          </td>
        </tr>
        <tr>
          <td class="text-left">Total:</td>
          <td class="text-right">
            =
            {{ message.debugging?.aiResponse?.usage.total_tokens }}
          </td>
        </tr>
      </tbody>
      <tbody v-else>
        <tr>
          <td class="text-left">Functions (estimated):</td>
          <td class="text-right">
            +
            {{ estimateChatTokens(message, state.chatState).functionTokens }}
          </td>
        </tr>
        <tr>
          <td class="text-left">Prompt (estimated):</td>
          <td class="text-right">
            +
            {{ estimateChatTokens(message, state.chatState).promptTokens }}
          </td>
        </tr>
        <tr>
          <td class="text-left">Completion (estimated):</td>
          <td class="text-right">
            +
            {{ estimateChatTokens(message, state.chatState).chatTokens }}
          </td>
        </tr>
        <tr>
          <td class="text-left">Total:</td>
          <td v-if="message.debugging?.usedTokens" class="text-right">
            = {{ message.debugging?.usedTokens }}
          </td>
          <td v-else class="text-right">
            =
            {{ estimateChatTokens(message, state.chatState).total }}
            (estimated)
          </td>
        </tr>
      </tbody>
    </q-markup-table>
  </div>
</template>

<style lang="sass">
/* Define the CSS class for the orange "glow" shadow */
.not-assistant-message
  box-shadow: inset 0 0 5px $secondary
  border-radius: 5px
</style>

<script setup lang="ts">
import { defineProps, PropType } from 'vue';
import { LLMTask, estimateChatTokens } from 'src/modules/chat';
import '@quasar/quasar-ui-qmarkdown/dist/index.css';
import { useTaskyonStore } from 'stores/taskyonState';

defineProps({
  message: {
    type: Object as PropType<LLMTask>,
    required: true,
  },
});

const state = useTaskyonStore();
</script>
