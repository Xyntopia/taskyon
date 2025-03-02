import {
  createRxDatabase,
  type RxDatabase,
  type RxCollection,
  type RxJsonSchema,
  type RxDocument,
  toTypedRxJsonSchema,
  type ExtractDocumentTypeFromTypedRxJsonSchema,
  addRxPlugin,
} from 'rxdb'
import { getRxStorageDexie } from 'rxdb/plugins/storage-dexie'
import { RxDBJsonDumpPlugin } from 'rxdb/plugins/json-dump'
import { removeKeys, removeUndefinedProperties, TaskNode, TaskContent } from './types'
// TOOD: remove at some point in the future...
import { RxDBDevModePlugin } from 'rxdb/plugins/dev-mode'
import { RxDBMigrationSchemaPlugin } from 'rxdb/plugins/migration-schema'
/* This is used so that we can migrate from old rxdb version to new ones (currently from v14.X to v15.X) */
import { migrateStorage } from 'rxdb/plugins/migration-storage'

addRxPlugin(RxDBDevModePlugin)
addRxPlugin(RxDBJsonDumpPlugin)
addRxPlugin(RxDBMigrationSchemaPlugin)

const taskNodeSchemaLiteral = {
  // TODO: remove everything thats "local" from task schema.
  //       we would like to try to make every task "immutable"
  //       so this include for example he state of the task.
  //       and other things that right now get changed "later".
  title: 'TaskNode schema',
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
    // TODO: do we really need this? in our task-based system roles are kind of pointless..
    //       we need to check if we can create roles in the conversion process when
    //       converting TaskNodes to a openai compatible message format for chatCompletion.
    role: {
      type: 'string',
    },
    // this can also be a json file...
    content: {
      type: 'string',
    },
    // rxdb doesn't support nested indices as of 2025/02 so we have to split our content object
    // long term this won't be a problem when we'll transition to pglite/wasm  anyways...
    // check this issue here:  https://github.com/pubkey/rxdb/issues/6821
    type: {
      type: 'string',
      maxLength: 128,
    },
    // the ID from a parent task which created several subtasks...
    // this is the ID which we will have to return result to...
    parentID: {
      type: ['string', 'null'],
    },
    priorID: {
      type: ['string', 'null'],
    },
    debugging: {
      type: 'string', // Storing debugging as a JSON string
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
    acl: {
      type: 'array',
      items: {
        type: 'string',
      },
    },
    sig: {
      type: 'string',
    },
  },
  required: ['id', 'role', 'content', 'type'],
  indexes: [
    'type', // <- this will create a simple index for the `firstName` field
    //['active', 'firstName'], // <- this will create a compound-index for these two fields
    //'active'
  ],
} as const

export const createTaskNodeMangoQuery = (labelString: string) => {
  const labels = labelString.split('\n')
  return {
    selector: {
      label: {
        $elemMatch: {
          $eq: labels[0],
        },
      },
    },
  }
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
const taskNodeSchemaTyped = toTypedRxJsonSchema(taskNodeSchemaLiteral)
type TaskNodeDocType = ExtractDocumentTypeFromTypedRxJsonSchema<typeof taskNodeSchemaTyped>
const taskNodeSchema: RxJsonSchema<TaskNodeDocType> = taskNodeSchemaLiteral

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
} as const

// eslint-disable-next-line @typescript-eslint/no-unused-vars
const fileMappingSchemaTyped = toTypedRxJsonSchema(fileMappingSchemaLiteral)
export type FileMappingDocType = ExtractDocumentTypeFromTypedRxJsonSchema<
  typeof fileMappingSchemaTyped
>
const fileMappingSchema: RxJsonSchema<FileMappingDocType> = fileMappingSchemaLiteral

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
} as const

// eslint-disable-next-line @typescript-eslint/no-unused-vars
const vectorMappingSchemaTyped = toTypedRxJsonSchema(vectorMappingSchemaLiteral)
type vectorMappingDocType = ExtractDocumentTypeFromTypedRxJsonSchema<
  typeof vectorMappingSchemaTyped
>
const vectorMappingSchema: RxJsonSchema<vectorMappingDocType> = vectorMappingSchemaLiteral

// Define the collection types
type TaskNodeCollection = RxCollection<TaskNodeDocType>
type FileMappingCollection = RxCollection<FileMappingDocType>
type VectorMappingCollection = RxCollection<vectorMappingDocType>

// Define the database type
type TaskyonDatabaseCollections = {
  tasknodes: TaskNodeCollection
  filemappings: FileMappingCollection
  vectormappings: VectorMappingCollection
}
export type TaskyonDatabase = RxDatabase<TaskyonDatabaseCollections>

export const collections = {
  tasknodes: {
    schema: taskNodeSchema,
    autoMigrate: true, // <- migration will not run at creation
    migrationStrategies: {
      1: function (oldDoc: Record<string, unknown>) {
        if (oldDoc.priorID) {
          // we are renaming the priorID, but our parentID property remains,
          // because we are using it to hint to the parent of a subtask now.
          oldDoc.priorID = oldDoc.parentID
        }
        return oldDoc
      },
      2: function (oldDoc: unknown) {
        return oldDoc
      },
      3: function (oldDoc: {
        state?: unknown
        configuration?: unknown
        childrenIDs?: unknown
        result?: unknown
        allowedTools?: unknown
        content: string
        type?: string
        [key: string]: unknown
      }) {
        // first, we delete all unused variables
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        const { state, configuration, childrenIDs, result, allowedTools, ...newDoc } = oldDoc
        const oldContent = JSON.parse(oldDoc.content)
        // then, split up our content into type / content again. we have to do this
        // so that is becomes searcheable inside our db...
        newDoc.type = oldContent.type ?? ('functionCall' in oldContent ? 'functioncall' : 'message')
        newDoc.content = JSON.stringify(oldContent.data ?? Object.values(oldContent)[0])
        return newDoc
      },
    },
  },
  filemappings: {
    schema: fileMappingSchema,
    autoMigrate: true, // <- migration will not run at creation
    migrationStrategies: {
      1: function (/*oldDoc*/) {
        // for this version we simply discard everything from version 0
        return null
      },
      2: function (/*oldDoc*/) {
        // for this version we simply discard everything from version 0
        return null
      },
      3: function (/*oldDoc*/) {
        // for this version we simply discard everything from version 0
        return null
      },
    },
  },
  vectormappings: {
    schema: vectorMappingSchema,
    autoMigrate: true, // <- migration will not run at creation
    migrationStrategies: {
      // for this version we simply discard everything from version 0
      1: function (/*oldDoc*/) {
        return null
      },
      2: function (/*oldDoc*/) {
        return null
      },
    },
  },
}

export async function createTaskyonDatabase(): Promise<TaskyonDatabase> {
  const newStorage = getRxStorageDexie()
  const db: TaskyonDatabase = await createRxDatabase<TaskyonDatabaseCollections>({
    name: 'taskyondb_v15',
    storage: newStorage,
  })

  await db.addCollections(collections)

  //here we do te migration from or old storage
  await import('rxdb-old/plugins/storage-dexie').then(
    ({ getRxStorageDexie: getRxStorageDexieOld }) => {
      void migrateStorage({
        database: db as unknown as RxDatabase,
        /**
         * Name of the old database,
         * using the storage migration requires that the
         * new database has a different name.
         */
        oldDatabaseName: 'taskyondb',
        oldStorage: getRxStorageDexieOld(), // RxStorage of the old database
        batchSize: 500, // batch size
        parallel: false, // <- true if it should migrate all collections in parallel. False (default) if should migrate in serial
        afterMigrateBatch: (/*input: AfterMigrateBatchHandlerInput*/) => {
          console.log('storage migration: batch processed')
        },
      })
    },
  )

  return db
}

export function transformTaskNodeToDocType(taskNode: TaskNode): TaskNodeDocType {
  // Mapping and transforming fields from TaskNode to TaskNodeDocType of taskyonDB/RxDB
  // TODO: maybe we can do the same thing here using zod parse? This would also add some more validation
  //       capabilities before saving anything in the db..
  const nonReactiveTaskNode = JSON.parse(JSON.stringify(taskNode)) as TaskNode
  const reducedTaskNode = removeUndefinedProperties(removeKeys(nonReactiveTaskNode, ['content']))
  const convertedTask: TaskNodeDocType = {
    ...reducedTaskNode,
    // Mapping and transforming fields from TaskNode to TaskNodeDocType
    content: JSON.stringify(nonReactiveTaskNode.content.data),
    type: nonReactiveTaskNode.content.type,
  }

  return convertedTask
}

export function transformDocToTaskNode(doc: RxDocument<TaskNodeDocType>): TaskNode {
  // Convert the database document to a JSON string in order to make a copy of it.
  const jsonString = JSON.stringify(doc.toJSON())
  const parsedDoc = JSON.parse(jsonString) as RxDocument<TaskNodeDocType>

  // Safely parse the debugging, configuration, and result fields
  const parsedContentRes = TaskContent.parse({
    data: JSON.parse(parsedDoc.content || ''),
    type: parsedDoc.type,
  })

  // Parse the JSON string and transform it into an TaskNode object
  // TODO:  try to throw errors here, when our TaskNode object and our database object differ.
  const tmpObj: TaskNode = {
    ...parsedDoc,
    role: TaskNode.shape.role.parse(parsedDoc.role),
    parentID: parsedDoc.parentID || undefined,
    priorID: parsedDoc.priorID || undefined,
    authorId: parsedDoc.authorId || undefined,
    created_at: parsedDoc.created_at || undefined,
    content: parsedContentRes, // we do this here, because in some situations the task has the wrong format...
  }
  const tn = TaskNode.parse(tmpObj)

  return tn
}
