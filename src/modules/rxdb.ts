import {
  createRxDatabase,
  RxDatabase,
  RxCollection,
  RxJsonSchema,
  //RxDocument,
  toTypedRxJsonSchema,
  ExtractDocumentTypeFromTypedRxJsonSchema,
  RxStorage,
} from 'rxdb';
import { getRxStorageDexie, RxStorageDexie } from 'rxdb/plugins/storage-dexie';
import type { RxStorageMemory } from 'rxdb/plugins/storage-memory';

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
