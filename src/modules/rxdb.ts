import {
  createRxDatabase,
  RxDatabase,
  RxCollection,
  RxJsonSchema,
  RxDocument,
  toTypedRxJsonSchema,
  ExtractDocumentTypeFromTypedRxJsonSchema,
} from 'rxdb';
import { getRxStorageDexie, RxStorageDexie } from 'rxdb/plugins/storage-dexie';
import type { RxStorageMemory } from 'rxdb/plugins/storage-memory';
import { addRxPlugin } from 'rxdb';
import { RxDBJsonDumpPlugin } from 'rxdb/plugins/json-dump';
import { RxDBMigrationPlugin } from 'rxdb/plugins/migration';
import { LLMTask } from './types';
// TOOD: remove at some point in the future...
import { RxDBDevModePlugin } from 'rxdb/plugins/dev-mode';
addRxPlugin(RxDBDevModePlugin);
addRxPlugin(RxDBJsonDumpPlugin);
addRxPlugin(RxDBMigrationPlugin);

const llmTaskSchemaLiteral = {
  title: 'LLMTask schema',
  version: 1,
  type: 'object',
  primaryKey: 'id',
  properties: {
    id: {
      type: 'string',
      primary: true,
      maxLength: 128, // <- the primary key must have set maxLength
    },
    role: {
      type: 'string',
      enum: ['system', 'user', 'assistant', 'function'],
    },
    content: {
      type: ['string', 'null'],
    },
    state: {
      type: 'string',
      enum: [
        'Open',
        'Queued',
        'In Progress',
        'Completed',
        'Error',
        'Cancelled',
      ],
    },
    configuration: {
      type: 'string', // Storing configuration as a JSON string
    },
    parentID: {
      type: ['string', 'null'],
    },
    childrenIDs: {
      type: 'array',
      items: {
        type: 'string',
      },
    },
    debugging: {
      type: 'string', // Storing debugging as a JSON string
    },
    result: {
      type: 'string', // Storing result as a JSON string
    },
    allowedTools: {
      type: 'array',
      items: {
        type: 'string',
      },
    },
    authorId: {
      type: ['string', 'null'],
    },
    created_at: {
      type: ['number', 'null'],
    },
  },
  required: ['id', 'role', 'state', 'content'],
} as const;

const llmTaskSchemaTyped = toTypedRxJsonSchema(llmTaskSchemaLiteral);
export type LLMTaskDocType = ExtractDocumentTypeFromTypedRxJsonSchema<
  typeof llmTaskSchemaTyped
>;
export const llmTaskSchema: RxJsonSchema<LLMTaskDocType> = llmTaskSchemaLiteral;

// Assert LLMTask to be LLMTaskDocType
//const testLLMTask: LLMTaskDocType = {} as LLMTask;
//const testLLMTaskDocType: LLMTask = {} as LLMTaskDocType;

//type Equals<X, Y> = (<T>() => T extends X ? 1 : 2) extends <T>() => T extends Y ? 1 : 2 ? true : false;
//type AreEqual = Equals<LLMTask, LLMTaskDocType>;

const fileMappingSchemaLiteral = {
  title: 'FileMapping schema',
  version: 1,
  type: 'object',
  primaryKey: 'uuid',
  properties: {
    uuid: { type: 'string', maxLength: 128 },
    opfs: { type: 'string' },
    openAIFileId: { type: 'string' },
    fileData: { type: 'string' },
  },
  required: ['uuid'],
} as const;

const fileMappingSchemaTyped = toTypedRxJsonSchema(fileMappingSchemaLiteral);
export type FileMappingDocType = ExtractDocumentTypeFromTypedRxJsonSchema<
  typeof fileMappingSchemaTyped
>;
export const fileMappingSchema: RxJsonSchema<FileMappingDocType> =
  fileMappingSchemaLiteral;

const vectorMappingSchemaLiteral = {
  title: 'VectorMapping schema',
  version: 1,
  type: 'object',
  primaryKey: 'vecid', // we do this, so that we can find documents very fast after commiting a vector search
  properties: {
    uuid: { type: 'string', maxLength: 128 },
    vecid: { type: 'string', maxLength: 128 },
  },
  required: ['uuid', 'vecid'],
  indexes: ['uuid'],
} as const;

const vectorMappingSchemaTyped = toTypedRxJsonSchema(
  vectorMappingSchemaLiteral
);
export type vectorMappingDocType = ExtractDocumentTypeFromTypedRxJsonSchema<
  typeof vectorMappingSchemaTyped
>;
export const vectorMappingSchema: RxJsonSchema<vectorMappingDocType> =
  vectorMappingSchemaLiteral;

// Define the collection types
export type LLMTaskCollection = RxCollection<LLMTaskDocType>;
export type FileMappingCollection = RxCollection<FileMappingDocType>;
export type VectorMappingCollection = RxCollection<vectorMappingDocType>;

// Define the database type
export type TaskyonDatabaseCollections = {
  llmtasks: LLMTaskCollection;
  filemappings: FileMappingCollection;
  vectormappings: VectorMappingCollection;
};
export type TaskyonDatabase = RxDatabase<TaskyonDatabaseCollections>;

// Function to create the database
/*
  TaskyonDatabase is build with reactivity in mind. you can supply a reactive map
  to the constructor. it will be kept in sync with the taskdb and supplies reactive changes
  to the UI. We could have used the function of RxDB for this. But this approach would have been
  less flexible...

    const TaskList = reactive<Map<string, LLMTask>>(new Map());
    const taskyonDBInstance = await createTaskyonDatabase('taskyondb');
    taskManagerInstance = new TaskManager(TaskList, taskyonDBInstance);
*/

export const collections = {
  llmtasks: {
    schema: llmTaskSchema,
    autoMigrate: true, // <- migration will not run at creation
    migrationStrategies: {
      // 1 means, this transforms data from version 0 to version 1
      1: function (/*oldDoc*/) {
        // for this version we simply discard everything from version 0
        return null;
      },
    },
  },
  filemappings: {
    schema: fileMappingSchema,
    autoMigrate: true, // <- migration will not run at creation
    migrationStrategies: {
      // for this version we simply discard everything from version 0
      1: function (/*oldDoc*/) {
        return null;
      },
    },
  },
  vectormappings: {
    schema: vectorMappingSchema,
    autoMigrate: true, // <- migration will not run at creation
    migrationStrategies: {
      // for this version we simply discard everything from version 0
      1: function (/*oldDoc*/) {
        return null;
      },
    },
  },
};

export async function createTaskyonDatabase(
  name: string,
  storage: RxStorageDexie | RxStorageMemory | undefined = undefined
): Promise<TaskyonDatabase> {
  const newStorage = storage || getRxStorageDexie();
  const db: TaskyonDatabase =
    await createRxDatabase<TaskyonDatabaseCollections>({
      name,
      storage: newStorage,
    });

  await db.addCollections(collections);

  return db;
}

export function transformLLMTaskToDocType(llmTask: LLMTask): LLMTaskDocType {
  // Mapping and transforming fields from LLMTask to LLMTaskDocType of taskyonDB/RxDB
  const nonReactiveLLMTask = JSON.parse(JSON.stringify(llmTask)) as LLMTask;
  return {
    ...nonReactiveLLMTask,
    configuration: llmTask.configuration
      ? JSON.stringify(llmTask.configuration)
      : undefined,
    debugging: llmTask.debugging
      ? JSON.stringify(llmTask.debugging)
      : undefined,
    result: llmTask.result ? JSON.stringify(llmTask.result) : undefined,
  };
}

export function transformDocToLLMTask(
  doc: RxDocument<LLMTaskDocType>
): LLMTask {
  // Convert the database document to a JSON string
  const jsonString = JSON.stringify(doc.toJSON());

  const parsedDoc = JSON.parse(jsonString) as Record<string, unknown>;

  // Safely parse the debugging, configuration, and result fields
  const parsedDebugging =
    typeof parsedDoc.debugging === 'string'
      ? (JSON.parse(parsedDoc.debugging) as Record<string, unknown>)
      : {};
  const parsedConfiguration =
    typeof parsedDoc.configuration === 'string'
      ? (JSON.parse(parsedDoc.configuration) as Record<string, unknown>)
      : undefined;
  const parsedResult =
    typeof parsedDoc.result === 'string'
      ? (JSON.parse(parsedDoc.result) as Record<string, unknown>)
      : undefined;

  // Parse the JSON string and transform it into an LLMTask object
  const tmpObj = {
    ...parsedDoc,
    debugging: parsedDebugging,
    configuration: parsedConfiguration,
    result: parsedResult,
  };
  const llmTask = LLMTask.parse(tmpObj);

  return llmTask;
}

/*async function main() {
  const db = await createDatabase("")

  // Example usage
  const llmTaskDoc = await db.llmtasks.insert({
    id: 'task1',
    role: 'user',
    content: 'Some content',
    state: 'Open',
  });

  // ... other operations ...
}

main().catch((err) => console.error(err));
*/
