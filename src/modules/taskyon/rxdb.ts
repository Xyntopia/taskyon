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
  // TODO: remove everything thats "local" from task schema.
  //       we would like to try to make every task "immutable"
  //       so this include for example he state of the task.
  //       and other things that right now get changed "later". 
  title: 'LLMTask schema',
  version: 3,
  type: 'object',
  primaryKey: 'id',
  properties: {
    id: {
      type: 'string',
      primary: true,
      maxLength: 128, // <- the primary key must have set maxLength
    },
    name: {
      type: 'string',
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
    // this can be used to give permissions to tasks,
    // declare functions, UI elements and other things.
    label: {
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
  version: 2,
  type: 'object',
  primaryKey: 'uuid',
  properties: {
    uuid: { type: 'string', maxLength: 128 },
    // filename in opfs
    opfs: { type: 'string' },
    openAIFileId: { type: 'string' },
    // we can give each file several labels which helps has to put them into different categories
    // such as tools, different projects, etc...
    labels: {
      type: 'array',
      items: {
        type: 'string',
      },
    },
    // TODO: we're not sure if we need a file path?
    fileType: { type: 'string' },
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
      2: function (oldDoc: LLMTaskDocType) {
        return oldDoc;
      },
      3: function (oldDoc: LLMTaskDocType) {
        // we simply added additional fields, so no problem here :).
        return oldDoc;
      },
    },
  },
  filemappings: {
    schema: fileMappingSchema,
    autoMigrate: true, // <- migration will not run at creation
    migrationStrategies: {
      1: function (/*oldDoc*/) {
        // for this version we simply discard everything from version 0
        return null;
      },
      2: function (/*oldDoc*/) {
        // for this version we simply discard everything from version 0
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
  // Convert the database document to a JSON string in order to make a copy of it.
  const jsonString = JSON.stringify(doc.toJSON());
  const parsedDoc = JSON.parse(jsonString) as RxDocument<LLMTaskDocType>;

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
  // TODO:  try to throw errors here, when our LLMTask object and our database object differ.
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
