import { boot } from 'quasar/wrappers';
import { ref, reactive } from 'vue';
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
    const TaskList = reactive<Record<string, LLMTask>>({});
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

  void run(state.chatState, taskManagerRef);
});
