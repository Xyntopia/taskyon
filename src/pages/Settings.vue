<template>
  <q-page :class="$q.dark.isActive ? 'bg-primary' : 'white'">
    <q-tabs v-model="tab" align="justify">
      <q-tab name="settings" label="Settings" />
      <q-tab name="instructions" label="Instructions" />
      <q-tab name="configuration" label="Agent Configuration" />
    </q-tabs>
    <q-tab-panels v-model="tab" animated :class="$q.dark.isActive ? 'bg-primary' : 'white'">
      <q-tab-panel name="settings">
        <Settings></Settings>
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
import Settings from 'components/Settings.vue';
import ObjectTreeView from 'components/ObjectTreeView.vue';

const tab = ref('settings'); // Default to the first tab
const state = useTaskyonStore();
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const { chatState, ...allSettings } = state;
const { Tasks, ...chatStateProperties } = toRefs(state.chatState);
const expanded = ref(false);
</script>
