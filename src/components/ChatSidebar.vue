<!-- Sidebar -->
<template>
  <q-list dense class="q-pa-xs">
    <!-- Conversation Area -->
    <q-expansion-item dense default-opened hide-expand-icon>
      <template v-slot:header>
        <div class="col row q-gutter-sm items-end justify-around">
          <div class="col-auto">
            <q-icon name="svguse:taskyon_mono_opt.svg#taskyon" size="sm" />
          </div>
          <div class="col-auto text-weight-medium">Conversation Threads</div>
        </div>
      </template>
      <div class="column items-stretch">
        <q-list>
          <q-item
            dense
            v-for="conversationId in conversationIDs"
            :key="conversationId.id"
            @click="state.chatState.selectedTaskId = conversationId.id"
            to="/"
            clickable
            v-ripple
          >
            <!--q-item-section avatar>
              <q-icon name="chat_bubble" size="xs" />
            </!q-item-section-->
            <q-item-section
              v-for="(selected, idx) in [
                state.chatState.selectedTaskId == conversationId.id,
              ]"
              :key="idx"
              lines
              :class="
                selected
                  ? [
                      'text-weight-bolder',
                      $q.dark.isActive ? 'text-secondary' : 'text-black',
                    ]
                  : [$q.dark.isActive ? 'text-white' : 'text-primary']
              "
            >
              {{
                selected
                  ? '> ' + activeTask?.name
                  : conversationId.name ||
                    'Thread' + conversationId.id.substring(0, 3)
              }}
              <q-tooltip> Select Conversation </q-tooltip>
            </q-item-section>
            <q-item-section side>
              <q-btn
                dense
                icon="delete"
                size="sm"
                flat
                @click="onDeleteThread(conversationId.id)"
              >
                <q-tooltip anchor="center right" self="center left">
                  Delete Conversation
                </q-tooltip>
              </q-btn>
            </q-item-section>
          </q-item>
        </q-list>
        <div class="row justify-around items-center">
          <q-btn
            dense
            flat
            @click="state.chatState.selectedTaskId = undefined"
            to="/"
          >
            <q-icon name="add" />
            <q-tooltip> Create a new conversation </q-tooltip>
          </q-btn>
          <q-btn dense flat icon="search" to="/TaskManager"
            ><q-tooltip>Search for more conversations</q-tooltip></q-btn
          >
        </div>
      </div>
    </q-expansion-item>
    <q-separator spaced />
    <!-- Settings Area -->
    <q-item class="fit column items-center">
      <SimpleSettings class="col-auto" vertical reduced></SimpleSettings>
    </q-item>
    <q-item>
      <q-btn flat icon="mdi-tools" label="Tools" to="/tools"></q-btn>
      <q-btn
        flat
        icon="manage_accounts"
        label="Accounts"
        to="/settings/llmproviders"
      ></q-btn>
    </q-item>
  </q-list>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue';
import { deleteTaskThread, TaskManager } from 'src/modules/taskyon/taskManager';
import SimpleSettings from 'components/SimpleSettings.vue';
import { useTaskyonStore } from 'stores/taskyonState';
import { LLMTask } from 'src/modules/taskyon/types';

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

const activeTask = ref<LLMTask | undefined>();

watch(
  () => state.chatState.selectedTaskId,
  async (newTaskId) => {
    const tm = await state.getTaskManager();
    if (newTaskId) {
      activeTask.value = await tm.getTask(newTaskId);
    }
  }
);

void state.getTaskManager().then(async (tm) => {
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
