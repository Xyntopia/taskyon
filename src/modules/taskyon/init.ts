import { useTyTaskManager } from './taskManager';
import type { TaskNode } from './types';
import { createTaskyonDatabase, TaskyonDatabase } from './rxdb';
import {
  TaskWorkerController,
  taskWorker as runTaskWorker,
} from './taskWorker';
import type { Tool } from './tools';
import { loadFile } from 'src/modules/loadFiles';
// TODO: make webpack automatically add all tool files from /tools/*
import { executeJavaScript } from '../tools/executeJavaScript';
import { executePythonScript } from '../tools/executePython';
import { llmSettings } from './types';

export async function initTaskyon(
  llmSettings: llmSettings,
  apiKeys: Record<string, string>,
  taskWorkerController: TaskWorkerController,
  logError: (message: string) => void,
  // we explicitly provide a tasklist here, this gives us the chance to provide a reactive
  // value in order to get updates to the list of tasks immediatly reflected in the UI.
  TaskList: Map<string, TaskNode>,
  AdditionalTools: Tool[],
) {
  const ToolList: Tool[] = [
    executePythonScript,
    // TODO: add local context(task) search
    // localVectorStoreSearch,
    executeJavaScript,
    ...AdditionalTools,
  ];

  console.log('initializing taskyondb');
  let taskyonDBInstance: TaskyonDatabase | undefined = undefined;
  try {
    taskyonDBInstance = await createTaskyonDatabase();
  } catch (err) {
    console.log('could not initialize taskyonDB', err);
    logError(
      `could not initialize taskyonDB:\n ${JSON.stringify(err, null, 2)}`,
    );
  }
  console.log('initializing task manager');
  const taskManagerInstance = useTyTaskManager(
    TaskList,
    ToolList,
    taskyonDBInstance,
    llmSettings.vectorizationModel,
  );
  console.log('finished taskManager initialization');

  // add tools which have access to the taskManagerInstance itself

  ToolList.push({
    function: async ({ filename }: { filename: string }) => {
      const file = await taskManagerInstance.getFileByName(filename);
      const fileContent = await loadFile(file);
      return fileContent;
    },
    description: 'Get the contents of an uploaded file',
    name: 'getFileContent',
    parameters: {
      type: 'object',
      properties: {
        filename: {
          type: 'string',
        },
      },
      required: ['filename'],
    },
  });
  void taskManagerInstance.updateToolDefinitions();

  // keys could porentially be reactive here, so in theory, when they change in the GUI,
  // taskyon should automatically pick up on this...
  console.log('starting taskyon worker');
  void runTaskWorker(
    llmSettings,
    taskManagerInstance,
    apiKeys,
    taskWorkerController,
  );

  return taskManagerInstance;
}
