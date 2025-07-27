<!-- SqlQueryPage.vue (eslint‑safe, no `any`) -->
<template>
  <q-layout view="lHh LpR lfr">
    <q-page-container>
      <q-page class="row">
        <!-- SQL Card -->
        <q-card class="col q-ma-md">
          <q-card-section>
            <div class="text-h6">SQL Queries</div>
            <div class="text-subtitle2">Tables in DB: {{ allTables }}</div>
          </q-card-section>

          <q-card-section>
            <q-input
              v-model="sqlQuery"
              type="textarea"
              rows="3"
              autogrow
              label="SQL Query"
              placeholder="Enter SQL here"
            />
            <div class="row q-mt-md items-center q-gutter-sm">
              <q-btn label="Run Query" color="primary" @click="executeQuery" />
              <q-btn flat label="Add Sample Table" color="secondary" @click="addSampleTable" />
            </div>
          </q-card-section>

          <q-card-section v-if="queryResult">
            <div class="text-h6 q-mb-sm">Results</div>
            <pre style="max-height: 300px; overflow: auto">{{ formattedResult }}</pre>
          </q-card-section>
        </q-card>

        <!-- Taskyon iframe -->
        <div class="col" style="min-height: 0">
          <iframe
            id="taskyon"
            title="Taskyon agent"
            frameborder="0"
            src="http://localhost:9000"
            style="width: 100%; height: 99%"
          ></iframe>
        </div>
      </q-page>
    </q-page-container>
  </q-layout>
</template>

<script setup lang="ts">
import { ref, shallowRef, computed, onMounted } from 'vue'
import { getDatabase, type TyPGDB } from 'src/modules/pglite.api'
import { asyncComputed } from 'src/modules/vueUtils'

// Taskyon
import type { partialTyConfiguration } from 'src/modules/taskyon/apiTypes'
import { createTool, makeTaskResult, toolCall } from 'src/modules/taskyon/tools'
import { initializeTaskyon } from 'src/modules/client/tyClient'
import { dump } from 'js-yaml'
import { createChatCompletionTask } from 'src/modules/tools/chatCompletionTool'
import type { JSONSchema7 } from 'json-schema'

// Row interfaces (no `any`)
interface TableNameRow {
  table_name: string
}

// Reactive state
const sqlQuery = ref('SELECT * FROM sample_table;')
const queryResult = ref<unknown>(null)
const errorMessage = ref('')
const db = shallowRef<TyPGDB>()

// add sample table
async function addSampleTable() {
  try {
    await db.value?.exec(`
      CREATE TABLE IF NOT EXISTS sample_table (
        id SERIAL PRIMARY KEY,
        username VARCHAR(50) NOT NULL,
        email VARCHAR(120) NOT NULL UNIQUE,
        joined_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
      INSERT INTO sample_table (username, email)
      VALUES ('alice', 'alice@example.com')
      ON CONFLICT DO NOTHING;`)
  } catch (err) {
    console.error('sample table error', err)
  }
}

// list tables
const allTables = asyncComputed(async () => {
  if (!db.value) return [] as string[]
  const res = await db.value.query(
    "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public';",
  )
  return res.rows.map((r) => (r as TableNameRow).table_name)
}, [] as string[])

// execute query
async function executeQuery() {
  errorMessage.value = ''
  queryResult.value = null
  try {
    const res = await db.value?.query(sqlQuery.value)
    queryResult.value = res?.rows ?? null
  } catch (err) {
    queryResult.value = err instanceof Error ? err.message : String(err)
  }
}

const sqlschemaquery = `
-- Postgres ≥ 9.4 (jsonb_build_object / jsonb_agg)
SELECT jsonb_agg(
         jsonb_build_object(
           'table',   table_name,
           'columns', cols
         )
       ) AS db_schema
FROM (
  SELECT
    table_name,
    jsonb_agg(
      jsonb_build_object(
        'column',        column_name,
        'data_type',     data_type,
        'is_nullable',   is_nullable,
        'column_default', column_default
      )
      ORDER BY ordinal_position
    ) AS cols
  FROM information_schema.columns
  WHERE table_schema = 'public'       -- change if you need another schema
  GROUP BY table_name
  ORDER BY table_name
) t;
`

onMounted(async () => {
  db.value = await getDatabase('taskyon')

  // Taskyon tools
  const tools = [
    createTool({
      name: 'setSqlQuery',
      description: 'Replace the current SQL query in the editor with the provided string',
      parameters: {
        type: 'object',
        properties: { sql: { type: 'string', description: 'SQL to place in the editor' } },
        required: [],
        additionalProperties: false,
      } as const satisfies JSONSchema7,
      function: async ({ sql }) => {
        if (!sql) {
          const schema = await db.value!.query(sqlschemaquery)
          const toolPrompt = `
You are are the taskyon SQL assistant helping users write and execute SQL queries against the local
in-browser pglite PostgreSQL database.

You can use the tools provided to set the SQL query.
Always ensure that the SQL you generate is syntactically correct and safe to run.

The database has the following tables and columns:

    ${dump(schema)}

The current SQL query in the editor is:

    ${sqlQuery.value}

The current results of the last executed query are:

    ${dump(queryResult.value)}

Only use the tool 'setSqlQuery' Tool if you think the user wants to change the SQL query.
`

          return makeTaskResult([
            createChatCompletionTask({
              prompts: [toolPrompt],
              goal: 'ChooseTool',
              allowedTools: ['setSqlQuery'],
            }),
          ])
        }

        sqlQuery.value = sql
        return makeTaskResult([
          {
            role: 'assistant',
            content: {
              type: 'message',
              data: `The SQL query has been updated to:\n\`\`\`sql\n${sql}\n\`\`\``,
            },
          },
          {
            role: 'system',
            content: {
              type: 'return',
              data: 'OK',
            },
          },
        ])
      },
    }),
  ]

  const configuration: partialTyConfiguration = {
    llmSettings: {
      selectedApi: 'taskyon',
      enableOpenAiTools: false,
      enableToolChooser: true,
      entryNode: toolCall({ name: 'setSqlQuery', arguments: {} }),
    },
    appConfiguration: { guiMode: 'default' },
  }
  void initializeTaskyon(tools, configuration)
})

// formatted result
const formattedResult = computed(() => JSON.stringify(queryResult.value, null, 2))
</script>
