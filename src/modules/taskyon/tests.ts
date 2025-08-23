import type OpenAI from 'openai'
import { useNlpWorker } from './webWorkerApi'
import { useTaskyonStore } from 'src/stores/taskyonState'
import { chat2Md, getTextFile } from './taskUtils'
import { useAppStateStore } from 'src/stores/appState'
import { useIpfs } from './ipfs'
import { getDatabase } from '../pglite.api'
import { createDeepTransformer, normalizeFalsyValues } from '../utils'
import { useGdrive } from '../gdrive'
import { craeteToolJsonSchema, summarizeTools } from './tools'
import { zodToYamlString } from '../yamlUtils'
import z from 'zod'
import type { JSONSchema7 } from 'json-schema'
import { jsonSchemaToYamlString } from '../yamlUtils'
import type { SecretStore } from '../crudWrapper'
import type { Asyncify } from '../../../packages/taskyon/src/utils/tsHelpers'
import type { TaskNode } from '@taskyon/taskyon'
import { ToolBase } from '@taskyon/taskyon'
import { decompressEncryptedObject, encryptCompressObject } from '../fileUtils'
import { gDriveSyncPort } from './sync'

const tystate = useTaskyonStore()
const state = useAppStateStore()

async function createTestKeys() {
  const recoveryKey = (
    await window.crypto.subtle.generateKey(
      {
        name: 'RSA-OAEP',
        modulusLength: 2048,
        publicExponent: new Uint8Array([1, 0, 1]),
        hash: 'SHA-256',
      },
      true,
      ['encrypt', 'decrypt'],
    )
  ).publicKey

  // Generate a symmetric key (AES-GCM)
  const sessionKey = await window.crypto.subtle.generateKey(
    {
      name: 'AES-GCM',
      length: 256,
    },
    true,
    ['encrypt', 'decrypt'],
  )
  return { recoveryKey, sessionKey }
}

export async function testGdriveZipRoundtrip() {
  const t0 = Date.now()
  const logs: string[] = []
  const steps: Array<{ step: string; ok: boolean; detail?: unknown }> = []

  function log(step: string, detail?: unknown, ok = true) {
    const msg = `[${new Date().toISOString()}] ${step}${detail ? `: ${JSON.stringify(detail)}` : ''}`
    console.log(msg)
    logs.push(msg)
    steps.push({ step, ok, detail })
  }

  try {
    // 2) pick a fresh directory so tests don’t clash
    const directory = `taskyon/taskyon-tests/${new Date().toISOString().replace(/[:.]/g, '-')}`
    log('target directory chosen', directory)

    const gdport = gDriveSyncPort(directory)

    const objs: Record<string, unknown> = {
      'a1f2c3d4e5.txt': 'hello A',
      'b6c7d8e9f0.json': { k: 1 },
      'deadbeefcaf0.md': ['# hi'],
    }
    log('prepared test data', objs)

    const filenames = Object.keys(objs)
    const archiveName = 'roundtrip.tyt'

    const { recoveryKey, sessionKey } = await createTestKeys()
    log('created keys', { recoveryKey, sessionKey })

    // compress objects "locally" (for the test)
    const packed = await encryptCompressObject(
      objs,
      archiveName,
      () => recoveryKey,
      () => sessionKey,
    )
    log('created encrypted msgpack file...')

    // we want to allow additional data to be send, for "upwards" compatibility
    // e.g. in the future we might want to add public keys and other things. Maybe we want to
    // encrypt tasks with synchronized session keys and similar things...
    gdport.send({
      type: 'addTasks',
      data: packed,
      info: archiveName,
      ids: filenames,
      additionalDataTest: 'hello!   we are simply testing additional keys',
    })
    // and send them of to gdrive...
    log('sent data to gdrive', { archiveName, filenames })

    // 4) for each filename, locate its zip via properties and download it
    const fileChecks: Array<{
      filename: string
      found: boolean
      blobSize?: number
      blobType?: string
      error?: string
    }> = []

    await new Promise((resolve) => {
      const unsub = gdport.receive((msg) => {
        if (msg.type === 'taskCreated') {
          log('received taskCreated message', msg)
          resolve(true)
          unsub()
        }
      })
    })

    for (const name of filenames) {
      try {
        gdport.send({ type: 'requestTask', id: name })
        await new Promise<boolean>((resolve) => {
          const unsub = gdport.receive(async (msg) => {
            if (msg.type === 'addTasks') {
              const decompressed = await decompressEncryptedObject(
                msg.data,
                msg.info,
                () => sessionKey,
              )
              const data = decompressed[name]
              log('decompressed and decrypted file', { name, decompressed })
              const info = {
                filename: name,
                found: true,
                blobSize: msg.data.length,
                ids: msg.ids,
                originalData: objs[name],
                data: data,
              }
              fileChecks.push(info)
              log(`download hit for ${name}`, info)

              resolve(true)
              unsub()
            } else if (msg.type === 'taskCreated') {
              log('received taskCreated message', msg)
              resolve(true)
            } else {
              fileChecks.push({ filename: name, found: false })
              log(`download miss for ${name}`, undefined, /*ok*/ false)
            }
          })
        })
      } catch (e: unknown) {
        const err = e instanceof Error ? e.message : String(e)
        fileChecks.push({ filename: name, found: false, error: err })
        log(`download error for ${name}`, err, /*ok*/ false)
      }
    }

    const allFound = fileChecks.every((fc) => fc.found)
    return {
      ok: allFound,
      directory,
      fileChecks,
      steps,
      logs,
      durationMs: Date.now() - t0,
    }
  } catch (e: unknown) {
    const err = e instanceof Error ? { message: e.message, stack: e.stack } : { message: String(e) }
    log('fatal error', err, /*ok*/ false)
    return {
      ok: false,
      error: err,
      steps,
      logs,
      durationMs: Date.now() - t0,
    }
  }
}

export const testSecretStore = (secretStore: Asyncify<SecretStore>) => async () => {
  console.log('request a random secret from the store')

  const secretName = 'MYTESTTOKEN'
  await secretStore.deleteSecret('diagnostics', secretName)
  const MYTESTTOKEN = await secretStore.getSecret('diagnostics', secretName, true)

  // Generate a random string as the test secret
  const test_secret = Math.random().toString(36).slice(2) + Date.now().toString()
  await secretStore.setSecret('diagnostics', secretName, test_secret)
  const returned_secret = await secretStore.getSecret('diagnostics', secretName, true)

  await secretStore.deleteSecret('diagnostics', 'unknown_secret')
  const undefinedSecret = await secretStore.getSecret('diagnostics', 'unknown_secret', true)

  return {
    MYTESTTOKEN,
    returned_secret,
    test_secret,
    undefinedSecret,
  }
}

export async function testToolLista() {
  console.log('gather all available tools in a list!')

  const tm = await tystate.getTaskManager()

  const allTools = (await tm.updateToolDefinitions()) ?? []
  return {
    'all tools': summarizeTools(Object.keys(allTools), allTools),
  }
}

export function testJsonSchemas() {
  console.log('create test schemas!')

  return {
    toolBaseJsonSchema: craeteToolJsonSchema(),
    toolJsonSchema: z.toJSONSchema(ToolBase, { unrepresentable: 'any' }),
    yamlString: zodToYamlString(ToolBase),
  }
}

export async function testGdriveUpload() {
  const { publishMarkdown } = useGdrive()

  const markdownContent =
    '# Sample Markdown\n\nThis is a sample markdown file generated by Taskyon to test Gdrive functionality.\n\n' +
    new Date().toISOString()

  const gdriveFile = await publishMarkdown(
    markdownContent,
    state.appConfiguration.gdriveDir,
    'taskyon_test.md',
    true,
  )

  return gdriveFile

  //throw { message: 'could not found the task we just loaded!!' };
}

export function testCreateDeepTansformer() {
  const errors: unknown[] = []
  function assert(cond: unknown, msg: string) {
    if (!cond) errors.push(msg)
  }

  // Test 1: key-normalization
  const robustKeys = createDeepTransformer({
    keyFn: (k) =>
      String(k)
        .toLowerCase()
        .replace(/[^a-z0-9]/g, ''),
  })
  const input1 = {
    'Foo-Bar': 1,
    Nested_Key: { 'Inner Map': 2 },
    arr: [{ 'X-Y': 3 }],
  }
  const expected1 = {
    foobar: 1,
    nestedkey: { innermap: 2 },
    arr: [{ xy: 3 }],
  }
  const output1 = robustKeys(input1)
  assert(
    JSON.stringify(output1) === JSON.stringify(expected1),
    `robustKeys failed:\n  expected ${JSON.stringify(expected1)}\n  got      ${JSON.stringify(output1)}`,
  )

  // Test 2: falsy-value normalization
  const normalize = normalizeFalsyValues()
  const input2 = {
    a: 'no',
    b: 'yes',
    c: 0,
    d: 'OK',
    nested: ['n/a', 'Y'],
  }
  const expected2 = {
    a: false,
    b: 'yes',
    c: false,
    d: 'OK',
    nested: [false, 'Y'],
  }
  const output2 = normalize(input2)
  assert(
    JSON.stringify(output2) === JSON.stringify(expected2),
    `normalizeFalsyValues failed:\n  expected ${JSON.stringify(expected2)}\n  got      ${JSON.stringify(output2)}`,
  )

  return {
    success: errors.length === 0,
    errors,
  }
}

export const testChatCompletion = async () => {
  console.log('request a random secret from the store')

  const tm = await tystate.getTaskManager()

  const stopSignal = new AbortController().signal

  // Invoke the real tool
  const { tool: chatCompletion } = await tm.getToolDefinition('chatCompletion')
  let structuredResponse
  if (chatCompletion && 'function' in chatCompletion && chatCompletion.function !== undefined) {
    structuredResponse = await chatCompletion.function(
      {
        model: 'google/gemini-2.5-flash-lite',
        prompts: [
          `Please respond with a JSON object matching the provided schema. This is meant as an example!  So you can simply come up with a random user and preferences.`,
        ],
        schema: {
          type: 'object',
          properties: {
            user: {
              type: 'object',
              description: new Date().toISOString(),
              properties: {
                id: { type: 'string' },
                name: { type: 'string' },
              },
              additionalProperties: false,
              required: ['id', 'name'],
            },
            preferences: {
              type: 'object',
              properties: {
                theme: { type: 'string', enum: ['light', 'dark'] },
              },
              additionalProperties: false,
              required: ['theme'],
            },
          },
          additionalProperties: false,
          required: ['user', 'preferences'],
        },
      },
      {
        taskChain: [],
        getSecret: () => Promise.resolve('test'),
        setSecret: () => {
          console.log('set test secret')
          return Promise.resolve()
        },
        stopSignal,
        toolId: 'N/A',
      },
    )
  }

  return {
    structuredResponse,
  }
}

export const testPGLite = async () => {
  const db = await getDatabase('chatStore')
  return {
    db,
    pgvector: await db.exec('CREATE EXTENSION IF NOT EXISTS vector;'),
    createTable: await db.exec(`
      CREATE TABLE IF NOT EXISTS test (
        id SERIAL PRIMARY KEY,
        task TEXT,
        vec vector(3),
        done BOOLEAN DEFAULT false
      );
      INSERT INTO test (task, done) VALUES ('Install PGlite from NPM', true);
      INSERT INTO test (task, done) VALUES ('Load PGlite', true);
      INSERT INTO test (task, done) VALUES ('Create a table', true);
      INSERT INTO test (task, done) VALUES ('Insert some data', true);
      INSERT INTO test (task) VALUES ('Update a task');
      INSERT INTO test (task, vec) VALUES ('test1', '[1,2,3]');
      INSERT INTO test (task, vec) VALUES ('test2', '[4,5,6]');
      INSERT INTO test (task, vec) VALUES ('test3', '[7,8,9]');
    `),
    query: await db.sql`SELECT * from test WHERE id = 1;`,
    'vector query': await db.exec(`
      SELECT
        task,
        vec,
        vec <-> '[3,1,2]' AS distance
      FROM test;
    `),
  }
}

export const testIPFS = async () => {
  const markdownContent =
    '# Sample Markdown\n\nThis is a sample markdown file generated by Taskyon to test Gdrive functionality.\n\n' +
    new Date().toISOString()

  const { exportToIpfs } = await useIpfs()

  const cid = await exportToIpfs(markdownContent)

  return {
    cid,
  }

  //throw { message: 'could not found the task we just loaded!!' };
}

const mockTask: TaskNode = {
  role: 'assistant',
  id: 'test',
  content: { type: 'message', data: 'Sample content for task node' },
}

const mockChatMessages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
  { role: 'user', content: 'Hello, how are you?' },
  { role: 'assistant', content: "I'm good, thank you!" },
]

const mockTools: Record<string, ToolBase> = {
  tool1: {
    name: 'tool1',
    description: 'Tool 1 description',
    parameters: {
      type: 'object',
      properties: {
        param1: {
          type: 'string',
          description: 'some parameter1.',
        },
      },
      required: ['param1'],
    },
  },
  tool2: {
    name: 'tool2',
    description: 'Tool 2 description',
    parameters: {
      type: 'object',
      properties: {
        param2: {
          type: 'string',
          description: 'some parameter2.',
        },
      },
    },
  },
}

export async function testTransformersPipeline() {
  const { pipeline } = await import('@huggingface/transformers')
  const extractor = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2')
  const output = await extractor('This is a simple test.', {
    pooling: 'mean',
    quantize: true,
    precision: 'binary',
  })
  /* Tensor {
  //   type: 'int8',
  //   data: Int8Array[49, 108, 24, ...],
  //   dims: [1, 48]
  }*/
  return output
}

export async function testVectorizerInitialization() {
  const nlpWorker = useNlpWorker()
  const modelName = state.llmSettings.vectorizationModel // Mock model name
  await nlpWorker.loadVecModel(modelName)
  await nlpWorker.loadVecTokenizer(modelName)
  return 'success'
}

export async function testVectorizeText() {
  const nlpWorker = useNlpWorker()
  const testText = 'Sample text for vectorization'
  const modelName = state.llmSettings.vectorizationModel // Mock model name
  const vector = await nlpWorker.vectorizeText(testText, modelName)
  const testSum = vector?.reduce((p, c) => p + c, 0)
  console.log('Vectorize Text Result Test Sum:', testSum)
  return testSum
}

export async function testEstimateChatTokens() {
  const nlpWorker = useNlpWorker()

  const tokens = await nlpWorker.estimateChatTokens(
    mockTask.content,
    mockChatMessages,
    mockTools,
    Object.values(mockTools).map((tool) => tool.name),
  )
  console.log('Estimate Chat Tokens Result:', tokens)
  return tokens
}

export async function markdownGeneration() {
  const tm = await tystate.getTaskManager()
  // first load the chat as mardown
  const yamlContent = await getTextFile('/tests/test_conversation.yaml')
  const lastLoadedTaskId = await tm.loadYamlConversation(yamlContent)
  //const newTaskId = await state.addMdTasks(markdownContent, undefined);
  // and delete this conversation again :)
  if (lastLoadedTaskId) {
    const taskList = await tm.getTaskChain(lastLoadedTaskId)
    const markdown = chat2Md(taskList)
    await tm.deleteTaskThread(lastLoadedTaskId)
    return {
      markdown,
    }
  }
  throw new Error('could not find the task we just loaded!!')
}

export function testJsonSchemaToYaml() {
  const schema: JSONSchema7 = {
    type: 'object',
    required: ['id'],
    properties: {
      id: { type: 'string', description: 'identifier' },
      count: { type: 'number', default: 0, description: 'counter' },
      tags: { type: 'array', items: { type: 'string' }, description: 'labels' },
      meta: {
        type: 'object',
        properties: {
          flag: { type: 'boolean' },
          tier: { enum: ['free', 'pro', 'enterprise'], description: 'user tier' },
        },
        description: 'metadata',
      },
    },
  }
  const postfix = ' (optional)'
  const out = jsonSchemaToYamlString(schema, postfix)

  const expected = `\
# identifier
id: string
# counter${postfix}
count: number
# labels${postfix}
tags:
  type: array
  items: string
# metadata${postfix}
meta:
  flag: boolean
  # user tier${postfix}
  tier: free|pro|enterprise
`

  if (out.trim() !== expected.trim()) {
    throw new Error(`
YAML output doesn’t match expected snapshot!

— expected —
${expected}

— received —
${out}
    `)
  }

  console.log('✅ test passed')
  return { out }
}
