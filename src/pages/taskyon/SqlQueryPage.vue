<!-- SqlQueryPage.vue (eslint‑safe, no `any`) -->
<template>
  <q-layout view="lHh LpR lfr">
    <q-page-container>
      <q-page class="row">
        <!-- SQL Card -->
        <q-card class="col">
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

          <q-card-section v-if="errorMessage" class="text-negative">
            <div class="text-h6 q-mb-sm">Error</div>
            <pre>{{ errorMessage }}</pre>
          </q-card-section>
        </q-card>

        <!-- Taskyon iframe -->
        <div class="col">
          <iframe
            id="taskyon"
            title="Taskyon agent"
            frameborder="0"
            src="http://localhost:9000"
            style="width: 100%; height: 100%; border: 1px solid #ccc"
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
import type { partialTyConfiguration } from 'src/modules/taskyon/iframeApiTypes'
import type { ClientTool } from 'src/modules/taskyon/tools'
import { createTool } from 'src/modules/taskyon/tools'
import { initializeTaskyon } from 'src/modules/client/tyClient'
import { dump } from 'js-yaml'

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
    return queryResult.value
  } catch (err) {
    errorMessage.value = err instanceof Error ? err.message : String(err)
    return { error: errorMessage.value }
  }
}

// Taskyon tools
const tools: ClientTool[] = [
  createTool({
    name: 'setSql',
    description: 'Replace the current SQL query in the editor with the provided string.',
    parameters: {
      type: 'object',
      properties: { sql: { type: 'string', description: 'SQL to place in the editor' } },
      required: ['sql'],
      additionalProperties: false,
    } as const,
    function: ({ sql }) => {
      sqlQuery.value = sql
      return 'ok'
    },
  }),
  createTool({
    name: 'runSql',
    description: 'Execute the SQL currently in the editor and return result rows.',
    parameters: { type: 'object', properties: {}, additionalProperties: false } as const,
    function: async () => executeQuery(),
  }),
]

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

const schema = asyncComputed<Record<string, unknown>>(async () => {
  if (db.value) {
    const res = await db.value.query(sqlschemaquery)
    return res
  }
  return {}
}, {})

// Taskyon configuration
const configuration: partialTyConfiguration = {
  llmSettings: {
    selectedApi: 'taskyon',
    enableOpenAiTools: false,
    enableToolChooser: true,
    taskChatTemplates: {
      basePrompt: `
You are a SQL assistant helping users write and execute SQL queries against a PostgreSQL database.
You can use the tools provided to set the SQL query, run it, and describe the database schema.
Always ensure that the SQL you generate is syntactically correct and safe to run.

The database has the following tables and columns:

    ${dump(schema.value)}
`,
    },
  },
  appConfiguration: { guiMode: 'default' },
}

onMounted(async () => {
  db.value = await getDatabase('taskyon')
  void initializeTaskyon(tools, configuration)
})

// formatted result
const formattedResult = computed(() => JSON.stringify(queryResult.value, null, 2))
</script>
