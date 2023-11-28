<template>
  <q-page>
    <q-tabs v-model="tab" align="justify">
      <q-tab name="settings" label="Settings" />
      <q-tab name="instructions" label="Instructions" />
      <q-tab name="configuration" label="Agent Configuration" />
    </q-tabs>
    <q-tab-panels v-model="tab" animated>
      <q-tab-panel name="settings">
        <q-toggle
          v-model="state.expertMode"
          label="Expert mode"
          left-label
          color="secondary"
        />
        <q-toggle
          v-model="state.showCosts"
          label="Show task costs"
          left-label
          color="secondary"
        />
        <q-separator spaced />
        <!-- Settings Area -->
        <div class="q-pa-sm q-gutter-md">
          <q-btn-toggle
            v-model="state.chatState.baseURL"
            no-caps
            rounded
            unelevated
            bordered
            outline
            toggle-color="secondary"
            color="white"
            text-color="black"
            :options="[
              { label: 'OpenAI API', value: getBackendUrls('openai') },
              {
                label: 'Openrouter.ai API',
                value: getBackendUrls('openrouter'),
              },
            ]"
          />
          <q-input
            placeholder="Add API key here!"
            label-color="white"
            dense
            filled
            v-model="state.chatState.openRouterAIApiKey"
            label="Openrouter.ai API key"
          />
          <q-input
            placeholder="Add API key here!"
            label-color="white"
            dense
            filled
            v-model="state.chatState.openAIApiKey"
            label="OpenAI API Key"
          />
        </div>
      </q-tab-panel>
      <q-tab-panel name="instructions">
        <ObjectTreeView v-model="chatStateProperties.taskChatTemplates.value" />
      </q-tab-panel>
      <q-tab-panel name="configuration">
        <ObjectTreeView v-model="chatStateProperties" />
      </q-tab-panel>
    </q-tab-panels>
  </q-page>
</template>

<script setup lang="ts">
import { toRefs, ref } from 'vue';
import { useTaskyonStore } from 'stores/taskyonState';
import { getBackendUrls } from 'src/modules/chat';
import ObjectTreeView from 'components/ObjectTreeView.vue';

const tab = ref('settings'); // Default to the first tab
const state = useTaskyonStore();
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const { chatState, ...allSettings } = state;
const { Tasks, ...chatStateProperties } = toRefs(state.chatState);
const expanded = ref(false);
</script>
