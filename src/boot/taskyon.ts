import { boot } from 'quasar/wrappers';
import { reactive } from 'vue';
import { TaskManager } from 'src/modules/taskManager';
import { LLMTask } from 'src/modules/types';
import { createTaskyonDatabase, TaskyonDatabase } from 'src/modules/rxdb';
import { run } from 'src/modules/taskWorker';
import { useTaskyonStore } from 'src/stores/taskyonState';

// Singleton holder for TaskManager
let taskManagerInstance: TaskManager;
export const errors: string[] = [];

export function logError(message: string) {
  errors.push(message);
}

// Function to get or create the TaskManager instance
export async function getTaskManager() {
  if (!taskManagerInstance) {
    // we are creating a reactive map for our memory-based task databae
    // this ensures, that we receive upates for our task in our UI.
    const TaskList = reactive<Map<string, LLMTask>>(new Map());
    console.log('initializing taskyondb');
    let taskyonDBInstance: TaskyonDatabase | undefined = undefined;
    try {
      taskyonDBInstance = await createTaskyonDatabase('taskyondb');
    } catch (err) {
      console.log('could not initialize taskyonDB', err);
      logError(
        `could not initialize taskyonDB:\n ${JSON.stringify(err, null, 2)}`
      );
    }
    console.log('initializing task manager');
    taskManagerInstance = new TaskManager(TaskList, taskyonDBInstance);
  }
  console.log('finished initialization');
  return taskManagerInstance;
}

// "async" is optional;
// more info on params: https://v2.quasar.dev/quasar-cli/boot-files
export default boot(async (/* { app, router, ... } */) => {
  const state = useTaskyonStore();
  const taskManagerRef = await getTaskManager();

  // keys are reactive here, so in theory, when they change, taskyon should automatically
  // pick up on this...
  console.log('starting taskyon worker');
  void run(state.chatState, taskManagerRef, state.keys);
});
