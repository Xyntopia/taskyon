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
            icon="reviews"
            @click="state.chatState.selectedTaskId = undefined"
          >
            <q-tooltip> Create a new conversation </q-tooltip>
          </q-btn>
          <q-btn class="col" dense flat icon="search" to="/TaskManager"
            ><q-tooltip>Search for more conversations</q-tooltip></q-btn
          >
        </div>
        <q-list>
          <q-item
            dense
            v-for="conversationId in conversationIDs"
            :key="conversationId.id"
            @click="state.chatState.selectedTaskId = conversationId.id"
            to="/"
            clickable
            v-ripple
            active-class=""
          >
            <q-item-section avatar>
              <q-icon name="chat_bubble" size="xs" />
            </q-item-section>
            <q-item-section>
              {{
                conversationId.name ||
                'Thread' + conversationId.id.substring(0, 3)
              }}
            </q-item-section>
            <q-item-section side>
              <q-btn
                dense
                icon="delete"
                size="sm"
                flat
                @click="onDeleteThread(conversationId.id)"
              ></q-btn>
            </q-item-section>
          </q-item>
        </q-list>
      </div>
    </q-expansion-item>
    <q-separator spaced />
    <!-- App Links -->
    <div class="q-pa-md q-gutter-xs">
      <Settings reduced></Settings>
      <q-btn flat icon="mdi-tools" label="Tools" to="/tools"></q-btn>
      <q-btn flat icon="manage_accounts" label="Accounts" to="/settings"></q-btn>
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
import { deleteTaskThread, TaskManager } from 'src/modules/taskyon/taskManager';
import Settings from 'components/Settings.vue';
import { useTaskyonStore } from 'stores/taskyonState';

const state = useTaskyonStore();

type taskEntry = { id: string; name: string | undefined };

const conversationIDs = ref<taskEntry[]>([]);

async function getLeafTaskNames(tm: TaskManager) {
  const leafTaskIds = tm.getLeafTasks().reverse().slice(0, 10);
  let taskList: taskEntry[] = [];
  for (const id of leafTaskIds) {
    taskList.push({ id, name: (await tm.getTask(id))?.name });
  }
  return taskList;
}

void state.getTaskManager().then(async (tm) => {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  tm.subscribeToTaskChanges(() => {
    console.log('update threads!!');
    void getLeafTaskNames(tm).then((res) => {
      conversationIDs.value = res;
    });
  }, true);
  conversationIDs.value = await getLeafTaskNames(tm);
});

async function onDeleteThread(conversationId: string) {
  console.log('deleting thread!!', conversationId);
  const tm = await state.getTaskManager();
  state.chatState.selectedTaskId = undefined;
  await deleteTaskThread(conversationId, tm);
  conversationIDs.value = await getLeafTaskNames(tm);
}
</script>
