<!-- Sidebar -->
<template>
  <q-drawer
    v-model="state.drawerOpen"
    show-if-above
    :width="300"
    :breakpoint="500"
    bordered
    :class="[$q.dark.isActive ? 'bg-primary' : 'bg-grey-3']"
  >
    <q-list class="q-pa-xs">
      <div>
        set theme:
        <q-btn-toggle
          dense
          :toggle-color="$q.dark.isActive ? 'secondary' : 'bg-grey-3'"
          :model-value="$q.dark.mode"
          @update:modelValue="
            (value) => {
              $q.dark.set(value);
              state.darkTheme = value;
            }
          "
          label="Dark Theme"
          :options="[
            { label: 'Auto', value: 'auto' },
            { label: 'Light', value: false },
            { label: 'Dark', value: true },
          ]"
        />
      </div>
      <q-toggle
        v-model="state.expertMode"
        label="Expert Mode"
        left-label
        color="secondary"
      />
      <!-- Upload Area -->
      <q-expansion-item
        v-if="true"
        dense
        label="Upload"
        icon="upload"
        default-opened
      >
        <VecStoreUploader class="fit-height" />
        <!--
    <iframe id="vexvault" style="border: none" :src="uploaderURL" height="200"></iframe>
    -->
      </q-expansion-item>
      <q-separator spaced />
      <!-- Conversation Area -->
      <q-expansion-item dense label="Conversations" icon="list" default-opened>
        <div class="column items-stretch">
          <div class="row">
            <q-btn
              class="col"
              dense
              flat
              icon="add"
              @click="createNewConversation"
            ></q-btn>
            <q-btn dense flat icon="delete" @click="deleteAllTasks"
              ><q-tooltip :delay="500"
                >Delete all conversations!</q-tooltip
              ></q-btn
            >
          </div>
          <q-list>
            <q-item
              dense
              v-for="(conversationId, idx) in conversationIDs"
              :key="conversationId"
              @click="state.chatState.selectedTaskId = conversationId"
              clickable
              v-ripple
            >
              <q-item-section avatar>
                <q-icon name="chat_bubble" size="xs" />
              </q-item-section>
              <q-item-section> Conversation {{ idx }} </q-item-section>
              <q-item-section side>
                <q-btn
                  dense
                  icon="delete"
                  size="sm"
                  flat
                  @click="deleteConversation(conversationId, state.chatState)"
                ></q-btn>
              </q-item-section>
            </q-item>
          </q-list>
        </div>
      </q-expansion-item>
      <q-separator spaced />
      <!-- Settings Area -->
      <q-expansion-item dense label="Settings" icon="settings" default-opened>
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
      </q-expansion-item>
    </q-list>
  </q-drawer>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import VecStoreUploader from 'components/VecStoreUploader.vue';
import { deleteConversation, getBackendUrls } from 'src/modules/chat';
import { useTaskyonStore } from 'stores/taskyonState';

const state = useTaskyonStore();

function createNewConversation() {
  // we simply need to tell our task manager that we don't have any task selected
  // the next message which will be send, will be an orphan in this case.
  state.chatState.selectedTaskId = undefined;
}

function deleteAllTasks() {
  state.chatState.selectedTaskId = undefined;
  state.chatState.Tasks = {};
}

const conversationIDs = computed(() => {
  // extract all "top-level tasks" (orphan tasks) which
  // represent the start of conversations...
  const orphanTasks = Object.values(state.chatState.Tasks)
    .filter((t) => {
      return t.childrenIDs.length == 0;
    })
    .map((t) => t.id);
  return orphanTasks;
});
</script>
