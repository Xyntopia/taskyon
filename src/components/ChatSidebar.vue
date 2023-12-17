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
          <q-btn class="col" dense flat icon="search" to="/TaskManager"
            ><q-tooltip>Search for more conversations</q-tooltip></q-btn
          >
        </div>
        <q-list>
          <q-item
            dense
            v-for="conversationId in conversationIDs"
            :key="conversationId"
            @click="state.chatState.selectedTaskId = conversationId"
            to="/chat"
            clickable
            v-ripple
          >
            <q-item-section avatar>
              <q-icon name="chat_bubble" size="xs" />
            </q-item-section>
            <q-item-section>
              Thread {{ conversationId.substring(0, 3) }}
            </q-item-section>
            <q-item-section side>
              <q-btn
                dense
                icon="delete"
                size="sm"
                flat
                @click="onDeleteThread(conversationId)"
              ></q-btn>
            </q-item-section>
          </q-item>
        </q-list>
      </div>
    </q-expansion-item>
    <q-separator spaced />
    <!-- App Links -->
    <div class="q-pa-md q-gutter-xs">
      <q-btn flat icon="chat" label="Open Chat" to="/chat"></q-btn>
      <q-btn flat icon="settings" label="Settings" to="/settings"></q-btn>
      <q-btn flat icon="key" label="Set Keys" to="/settings"></q-btn>
      <Settings reduced></Settings>
    </div>
    <!-- Settings Area -->
    <!--
    <q-expansion-item dense label="Menu" icon="settings" default-closed>
    </q-expansion-item>
    -->
  </q-list>
</template>

<script setup lang="ts">
import { ref } from 'vue';
import { deleteTaskThread } from 'src/modules/taskManager';
import Settings from 'components/Settings.vue';
import { useTaskyonStore } from 'stores/taskyonState';
import { getTaskManager } from 'boot/taskyon';

const state = useTaskyonStore();

function createNewConversation() {
  // we simply need to tell our task manager that we don't have any task selected
  // the next message which will be send, will be an orphan in this case.
  state.chatState.selectedTaskId = undefined;
}

const conversationIDs = ref<string[]>([]);

void getTaskManager().then((tm) => {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  tm.subscribeToTaskChanges(() => {
    console.log('update threads!!');
    const leaftasks = tm.getLeafTasks().reverse().slice(0, 10);
    conversationIDs.value = leaftasks;
  }, true);
  conversationIDs.value = tm.getLeafTasks().reverse().slice(0, 10);
});

async function onDeleteThread(conversationId: string) {
  console.log('deleting thread!!', conversationId);
  const tm = await getTaskManager();
  state.chatState.selectedTaskId = undefined;
  await deleteTaskThread(conversationId, tm);
  conversationIDs.value = tm.getLeafTasks().reverse().slice(0, 10);
}
</script>
