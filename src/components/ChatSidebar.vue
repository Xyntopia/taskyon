<!-- Sidebar -->
<template>
  <q-list class="q-pa-xs">
    <!-- Conversation Area -->
    <q-expansion-item
      dense
      label="Conversation Threads"
      icon="list"
      default-opened
    >
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
            <q-item-section> Thread {{ idx }} </q-item-section>
            <q-item-section side>
              <q-btn
                dense
                icon="delete"
                size="sm"
                flat
                @click="deleteTaskThread(conversationId, state.chatState)"
              ></q-btn>
            </q-item-section>
          </q-item>
        </q-list>
      </div>
    </q-expansion-item>
    <q-separator spaced />
    <!-- Settings Area -->
    <q-expansion-item dense label="Settings" icon="settings" default-closed>
      <Settings />
    </q-expansion-item>
  </q-list>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { deleteTaskThread } from 'src/modules/chat';
import Settings from 'components/Settings.vue';
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
