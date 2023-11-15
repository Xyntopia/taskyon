import { createRxDatabase, addRxPlugin } from 'rxdb';
import { getRxStorageDexie } from 'rxdb/plugins/dexie';
import { RxDBAttachmentsPlugin } from 'rxdb/plugins/attachments';

// Add Dexie and Attachments plugins
addRxPlugin(getRxStorageDexie);
addRxPlugin(RxDBAttachmentsPlugin);

async function createDatabase() {
    const db = await createRxDatabase({
        name: 'taskyonDB',
        storage: getRxStorageDexie(),
    });

    // Define the schema for LLMTask
    const llmTaskSchema = {
        title: "LLMTask schema",
        version: 0,
        type: "object",
        properties: {
            id: {
                type: "string",
                primary: true
            },
            role: {
                type: "string",
                enum: ['system', 'user', 'assistant', 'function']
            },
            content: {
                type: ["string", "null"]
            },
            state: {
                type: "string",
                enum: ['Open', 'Queued', 'In Progress', 'Completed', 'Error']
            },
            context: {
                type: ["object", "null"],
                properties: {
                    message: {
                        type: ["object", "null"],
                        properties: {
                            // properties of OpenAIMessage
                        }
                    },
                    function: {
                        type: ["object", "null"],
                        properties: {
                            // properties of FunctionCall
                        }
                    },
                    model: {
                        type: ["string", "null"]
                    },
                    uploadedFiles: {
                        type: "array",
                        items: {
                            type: "string"
                        }
                    }
                }
            },
            parentID: {
                type: ["string", "null"]
            },
            childrenIDs: {
                type: "array",
                items: {
                    type: "string"
                }
            },
            debugging: {
                type: "object",
                properties: {
                    // properties of the debugging object
                }
            },
            result: {
                type: ["object", "null"],
                properties: {
                    // properties of TaskResult
                }
            },
            allowedTools: {
                type: ["array", "null"],
                items: {
                    type: "string"
                }
            },
            authorId: {
                type: ["string", "null"]
            },
            created_at: {
                type: ["number", "null"]
            }
        },
        required: ['id', 'role', 'state', 'childrenIDs'],
        attachments: {
            encrypted: false
        }
    };

    // Create the LLMTask collection
    await
