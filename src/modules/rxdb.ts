import { createRxDatabase, addRxPlugin } from 'rxdb';
import { getRxStorageDexie } from 'rxdb/plugins/storage-dexie';

async function createDatabase() {
    const db = await createRxDatabase({
        name: 'taskyonDatabase',
        storage: getRxStorageDexie(),
    });

    // Define the schema for LLMTask
    const llmTaskSchema = {
        title: 'LLMTask schema',
        version: 0,
        type: 'object',
        primaryKey: 'id',
        properties: {
            id: {
                type: 'string',
                primary: true
            },
            role: {
                type: 'string',
                enum: ['system', 'user', 'assistant', 'function']
            },
            content: {
                type: ['string', 'null']
            },
            state: {
                type: 'string',
                enum: ['Open', 'Queued', 'In Progress', 'Completed', 'Error']
            },
            context: {
                type: ['object', 'null'],
                properties: {
                    message: {
                        type: ['object', 'null'],
                        properties: {
                            // properties of OpenAIMessage
                        }
                    },
                    function: {
                        type: ['object', 'null'],
                        properties: {
                            // properties of FunctionCall
                        }
                    },
                    model: {
                        type: ['string', 'null']
                    },
                    uploadedFiles: {
                        type: 'array',
                        items: {
                            type: 'string'
                        }
                    }
                }
            },
            parentID: {
                type: ['string', 'null']
            },
            childrenIDs: {
                type: 'array',
                items: {
                    type: 'string'
                }
            },
            debugging: {
                type: 'object',
                properties: {
                    // properties of the debugging object
                }
            },
            result: {
                type: ['object', 'null'],
                properties: {
                    // properties of TaskResult
                }
            },
            allowedTools: {
                type: ['array', 'null'],
                items: {
                    type: 'string'
                }
            },
            authorId: {
                type: ['string', 'null']
            },
            created_at: {
                type: ['number', 'null']
            }
        },
        required: ['id', 'role', 'state', 'childrenIDs'],
        attachments: {
            encrypted: false
        }
    };

    // Create the LLMTask collection
    await db.addCollections({
        llmtasks: {
            schema: llmTaskSchema
        }
    });

    return db;
}

// Use the database
async function main() {
    const db = await createDatabase();


    // Example: Adding a new LLMTask
    const llmTaskDoc = await db.llmtasks.insert({
        id: 'task1',
        role: 'user',
        content: 'Some content',
        state: 'Open',
        childrenIDs: [],
        // ... other properties ...
    });

    // Example: Adding an attachment to the LLMTask
    const attachmentData = new Blob(['file data']); // Replace with actual file data
    await llmTaskDoc.putAttachment({
        id: 'myfile',
        data: attachmentData,
        type: 'text/plain'
    });

    // ... other operations ...
}

main().catch(err => console.error(err));
