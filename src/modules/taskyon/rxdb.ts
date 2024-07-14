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
import { TaskNode } from './types';
// TOOD: remove at some point in the future...
import { RxDBDevModePlugin } from 'rxdb/plugins/dev-mode';
addRxPlugin(RxDBDevModePlugin);
addRxPlugin(RxDBJsonDumpPlugin);
addRxPlugin(RxDBMigrationPlugin);

const taskNodeSchemaLiteral = {
  // TODO: remove everything thats "local" from task schema.
  //       we would like to try to make every task "immutable"
  //       so this include for example he state of the task.
  //       and other things that right now get changed "later".
  title: 'TaskNode schema',
  version: 0,
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
    // this can also be a json file...
    content: {
      type: 'string',
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
  required: ['id', 'role', 'state'],
} as const;

const taskNodeSchemaTyped = toTypedRxJsonSchema(taskNodeSchemaLiteral);
export type TaskNodeDocType = ExtractDocumentTypeFromTypedRxJsonSchema<
  typeof taskNodeSchemaTyped
>;
export const taskNodeSchema: RxJsonSchema<TaskNodeDocType> =
  taskNodeSchemaLiteral;

// Assert TaskNode to be TaskNodeDocType
//const testTaskNode: TaskNodeDocType = {} as TaskNode;
//const testTaskNodeDocType: TaskNode = {} as TaskNodeDocType;

//type Equals<X, Y> = (<T>() => T extends X ? 1 : 2) extends <T>() => T extends Y ? 1 : 2 ? true : false;
//type AreEqual = Equals<TaskNode, TaskNodeDocType>;

const fileMappingSchemaLiteral = {
  title: 'FileMapping schema',
  version: 3,
  type: 'object',
  primaryKey: 'uuid',
  properties: {
    uuid: { type: 'string', maxLength: 128 },
    name: { type: 'string' },
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

/* this is used to map our db objects to the labels in the 
vector index we can also save our calculated vectors in this in order to
exchange them between different taskyon nodes. */
const vectorMappingSchemaLiteral = {
  title: 'VectorMapping schema',
  version: 2,
  type: 'object',
  primaryKey: 'vecid', // we do this, so that we can find documents very fast after commiting a vector search
  properties: {
    uuid: { type: 'string', maxLength: 128 },
    vecid: { type: 'string', maxLength: 128 },
    // should be a binary-encoded vector...
    vector: { type: 'string' },
  },
  required: ['uuid', 'vecid'],
  indexes: ['uuid'],
} as const;

const vectorMappingSchemaTyped = toTypedRxJsonSchema(
  vectorMappingSchemaLiteral,
);
type vectorMappingDocType = ExtractDocumentTypeFromTypedRxJsonSchema<
  typeof vectorMappingSchemaTyped
>;
const vectorMappingSchema: RxJsonSchema<vectorMappingDocType> =
  vectorMappingSchemaLiteral;

// Define the collection types
type TaskNodeCollection = RxCollection<TaskNodeDocType>;
type FileMappingCollection = RxCollection<FileMappingDocType>;
type VectorMappingCollection = RxCollection<vectorMappingDocType>;

// Define the database type
export type TaskyonDatabaseCollections = {
  tasknodes: TaskNodeCollection;
  filemappings: FileMappingCollection;
  vectormappings: VectorMappingCollection;
};
export type TaskyonDatabase = RxDatabase<TaskyonDatabaseCollections>;

export const collections = {
  tasknodes: {
    schema: taskNodeSchema,
    autoMigrate: true, // <- migration will not run at creation
    migrationStrategies: {},
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
      3: function (/*oldDoc*/) {
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
      2: function (/*oldDoc*/) {
        return null;
      },
    },
  },
};

export async function createTaskyonDatabase(
  name: string,
  storage: RxStorageDexie | RxStorageMemory | undefined = undefined,
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

export function transformTaskNodeToDocType(
  taskNode: TaskNode,
): TaskNodeDocType {
  // Mapping and transforming fields from TaskNode to TaskNodeDocType of taskyonDB/RxDB
  // TODO: maybe we can do the same thing here using zod parse? This would also add some more validation
  //       capabilities before saving anything in the db..
  const nonReactiveTaskNode = JSON.parse(JSON.stringify(taskNode)) as TaskNode;
  return {
    ...nonReactiveTaskNode,
    content: JSON.stringify(taskNode.content),
    configuration: taskNode.configuration
      ? JSON.stringify(taskNode.configuration)
      : undefined,
    debugging: taskNode.debugging
      ? JSON.stringify(taskNode.debugging)
      : undefined,
    result: taskNode.result ? JSON.stringify(taskNode.result) : undefined,
  };
}

export function transformDocToTaskNode(
  doc: RxDocument<TaskNodeDocType>,
): TaskNode {
  // Convert the database document to a JSON string in order to make a copy of it.
  const jsonString = JSON.stringify(doc.toJSON());
  const parsedDoc = JSON.parse(jsonString) as RxDocument<TaskNodeDocType>;

  // Safely parse the debugging, configuration, and result fields
  const parsedContent =
    typeof parsedDoc.content === 'string'
      ? (JSON.parse(parsedDoc.content) as Record<string, unknown>)
      : {};
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

  // Parse the JSON string and transform it into an TaskNode object
  // TODO:  try to throw errors here, when our TaskNode object and our database object differ.
  const tmpObj = {
    ...parsedDoc,
    content: parsedContent, // we do this here, because in some situations the task has the wrong format...
    debugging: parsedDebugging,
    configuration: parsedConfiguration,
    result: parsedResult,
  };
  const tn = TaskNode.parse(tmpObj);

  return tn;
}
