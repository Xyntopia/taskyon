import {
  createTaskyonDatabase,
  LLMTaskDocType,
  TaskyonDatabase,
} from 'src/modules/rxdb';
import { describe, expect, it, beforeAll, afterAll } from '@jest/globals';
import { installQuasarPlugin } from '@quasar/quasar-app-extension-testing-unit-jest';
import { getRxStorageMemory } from 'rxdb/plugins/storage-memory';

//import { mount, shallowMount } from '@vue/test-utils';
//import { QBtn } from 'quasar';
//import MyButton from './demo/MyButton';

// Specify here Quasar config you'll need to test your component
installQuasarPlugin();

/*
describe('MyButton', () => {
  it('has increment method', () => {
    const wrapper = mount(MyButton);
    const { vm } = wrapper;

    expect(typeof vm.increment).toBe('function');
  });
*/

describe('rxdb operations', () => {
  let db: TaskyonDatabase;

  beforeAll(async () => {
    // Initialize the database before all tests
    const storage = getRxStorageMemory();
    db = await createTaskyonDatabase('taskyontestdb', storage);
  });

  afterAll(async () => {
    // Clean up after all tests have run
    await db.remove();
  });

  it('should save and load a task', async () => {
    // Define a new task
    const newTask: LLMTaskDocType = {
      id: 'task1',
      role: 'user',
      content: 'Some content',
      state: 'Open',
      context: '{}', // assuming default JSON string context
      debugging: '{}', // assuming default JSON string for debugging
      result: '{}', // assuming default JSON string for result
      allowedTools: [],
      // Add other required fields with default values if necessary
    };

    // Save the new task to the database
    await db.llmtasks.insert(newTask);

    // Retrieve the task from the database
    const taskFromDb = await db.llmtasks.findOne(newTask.id).exec();

    // Expect that the retrieved task matches the new task
    expect(JSON.stringify(taskFromDb?.toJSON())).toEqual(JSON.stringify(newTask));
  });
});
