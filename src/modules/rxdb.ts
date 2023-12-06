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
import { LLMTask } from './types';
addRxPlugin(RxDBJsonDumpPlugin);

const llmTaskSchemaLiteral = {
  title: 'LLMTask schema',
  version: 0,
  type: 'object',
  primaryKey: 'id',
  properties: {
    id: {
      type: 'string',
      primary: true,
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
    context: {
      type: 'string', // Storing context as a JSON string
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
  version: 0,
  type: 'object',
  primaryKey: 'uuid',
  properties: {
    uuid: { type: 'string' },
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

// Define the collection types
export type LLMTaskCollection = RxCollection<LLMTaskDocType>;
export type FileMappingCollection = RxCollection<FileMappingDocType>;

// Define the database type
export type TaskyonDatabaseCollections = {
  llmtasks: LLMTaskCollection;
  filemappings: FileMappingCollection;
};
export type TaskyonDatabase = RxDatabase<TaskyonDatabaseCollections>;

// Function to create the database
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

  await db.addCollections({
    llmtasks: { schema: llmTaskSchema },
    filemappings: { schema: fileMappingSchema },
  });

  return db;
}

export function transformLLMTaskToDocType(llmTask: LLMTask): LLMTaskDocType {
  // Mapping and transforming fields from LLMTask to LLMTaskDocType of taskyonDB/RxDB
  return {
    ...llmTask,
    context: llmTask.context ? JSON.stringify(llmTask.context) : undefined,
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

  // Safely parse the debugging, context, and result fields
  const parsedDebugging =
    typeof parsedDoc.debugging === 'string'
      ? (JSON.parse(parsedDoc.debugging) as Record<string, unknown>)
      : {};
  const parsedContext =
    typeof parsedDoc.context === 'string'
      ? (JSON.parse(parsedDoc.context) as Record<string, unknown>)
      : undefined;
  const parsedResult =
    typeof parsedDoc.result === 'string'
      ? (JSON.parse(parsedDoc.result) as Record<string, unknown>)
      : undefined;

  // Parse the JSON string and transform it into an LLMTask object
  const tmpObj = {
    ...parsedDoc,
    debugging: parsedDebugging,
    context: parsedContext,
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
