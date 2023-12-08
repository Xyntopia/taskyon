import { boot } from 'quasar/wrappers';
import { reactive } from 'vue';
import { TaskManager } from 'src/modules/taskManager';
import { LLMTask } from 'src/modules/types';
import { createTaskyonDatabase } from 'src/modules/rxdb';
import { run } from 'src/modules/taskWorker';
import { useTaskyonStore } from 'src/stores/taskyonState';

// Singleton holder for TaskManager
let taskManagerInstance: TaskManager;

// Function to get or create the TaskManager instance
export async function getTaskManager() {
  if (!taskManagerInstance) {
    const TaskList = reactive<Map<string, LLMTask>>(new Map());
    const taskyonDBInstance = await createTaskyonDatabase('taskyondb');
    taskManagerInstance = new TaskManager(TaskList, taskyonDBInstance);
  }
  return taskManagerInstance;
}

// "async" is optional;
// more info on params: https://v2.quasar.dev/quasar-cli/boot-files
export default boot(async (/* { app, router, ... } */) => {
  const state = useTaskyonStore();
  const taskManagerRef = await getTaskManager();

  // keys are reactive here, so in theory, when they change, taskyon should automatically
  // pick up on this...
  void run(state.chatState, taskManagerRef, state.keys);
});
