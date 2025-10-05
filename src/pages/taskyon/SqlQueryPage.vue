<!-- SqlQueryPage.vue -->
<template>
  <q-page class="row">
    <!-- SQL Card -->
    <q-card class="col q-ma-md" style="min-width: 200px">
      <q-card-section>
        <div class="text-h6">SQL Queries</div>
        <div class="text-subtitle2">Tables in DB ({{ db?.name }}): {{ allTables }}</div>
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

      <q-card-section v-if="queryResult !== null">
        <div class="row items-center justify-between">
          <div class="text-h6 q-mb-sm">Results</div>
          <q-btn-dropdown
            color="primary"
            size="sm"
            :icon="matContentCopy"
            label="Copy"
            flat
            dense
            :dropdown-icon="matArrowDropDown"
            class="q-mb-sm"
          >
            <q-list>
              <q-item v-close-popup clickable @click="copyJson">
                <q-item-section>Copy as JSON</q-item-section>
              </q-item>
              <q-item
                v-close-popup
                clickable
                :disable="!isTabularResult || !tableRows.length"
                @click="copyCsv"
              >
                <q-item-section>Copy as CSV</q-item-section>
              </q-item>
            </q-list>
          </q-btn-dropdown>
        </div>
        <q-tabs v-model="activeTab" dense class="q-mb-md">
          <q-tab name="table" label="Table" :disable="!isTabularResult" />
          <q-tab name="json" label="JSON" />
        </q-tabs>

        <div v-if="activeTab === 'table' && isTabularResult">
          <q-table
            :rows="tableRows"
            :columns="tableColumns"
            row-key="id"
            dense
            flat
            bordered
            :pagination="{ rowsPerPage: 10 }"
            style="max-height: 300px"
          />
        </div>

        <div v-else>
          <pre style="max-height: 300px; overflow: auto">{{ formattedResult }}</pre>
        </div>
      </q-card-section>
    </q-card>

    <!-- Taskyon iframe -->
    <div class="col" style="min-height: 0; min-width: 200px">
      <iframe
        id="taskyon"
        title="Taskyon agent"
        frameborder="0"
        :src="`${taskyonUrl}?iframe=true&profile=sql`"
        style="width: 100%; height: 99%"
      ></iframe>
    </div>
  </q-page>
</template>

<script setup lang="ts">
import { matArrowDropDown, matContentCopy } from '@quasar/extras/material-icons'
import type { TyPGDB } from '@taskyon/taskyon'
import {
  createChatCompletionTask,
  createTool,
  getDatabase,
  makeTaskResult,
  toolCall,
} from '@taskyon/taskyon'
import { dump } from 'js-yaml'
import type { JSONSchema7 } from 'json-schema'
import { copyToClipboard, Notify } from 'quasar'
import type { partialTyConfiguration } from 'src/modules/taskyon/apiTypes'
import { asyncComputed } from 'src/modules/vueUtils'
import { useAppStateStore } from 'src/stores/appState'
import { computed, markRaw, onMounted, ref, watchEffect } from 'vue'
import { initializeTaskyon } from '../../../packages/tyclient/src'

const taskyonUrl = window.location.origin
const state = useAppStateStore()

function copyJson() {
  copyToClipboard(formattedResult.value)
    .then(() => Notify.create({ message: 'Copied as JSON', color: 'primary' }))
    .catch(() => Notify.create({ message: 'Copy failed', color: 'negative' }))
}

function copyCsv() {
  if (!isTabularResult.value || tableRows.value.length === 0) return
  const cols = tableColumns.value.map((col) => col.name)
  const csvRows = [
    cols.join(','), // header
    ...tableRows.value.map((row) => cols.map((k) => JSON.stringify(row[k] ?? '')).join(',')),
  ]
  copyToClipboard(csvRows.join('\n'))
    .then(() => Notify.create({ message: 'Copied as CSV', color: 'primary' }))
    .catch(() => Notify.create({ message: 'Copy failed', color: 'negative' }))
}

// Row interfaces (no `any`)
interface TableNameRow {
  table_name: string
}

// Reactive state
const sqlQuery = ref('SELECT * FROM sample_table;')
const queryResult = ref<unknown>(null)
let lastQuery: string | null = null
const errorMessage = ref('')
const db = ref<TyPGDB>()
// we have to use watchEffect here, because a "computed" strips away private values
// from a class and our db instance would become useless
watchEffect(() => {
  if (!state.sessionId) {
    db.value = undefined
    return
  }
  void getDatabase(state.sessionId).then((database) => {
    db.value = markRaw(database)
  })
})

// Table view state
const isTabularResult = ref(false)
const tableRows = ref<Record<string, unknown>[]>([])
const tableColumns = ref<{ name: string; label: string; field: string; sortable: boolean }[]>([])
const activeTab = ref<'table' | 'json'>('json')

// Add sample table
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

// List tables
const allTables = asyncComputed(async () => {
  console.log('all tables', db.value?.name)
  if (!db.value) return [] as string[]
  const res = await db.value.query(
    "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public';",
  )
  return res.rows.map((r) => (r as TableNameRow).table_name)
}, [] as string[])

// Execute query and prepare tabular state
async function executeQuery() {
  errorMessage.value = ''
  queryResult.value = null
  isTabularResult.value = false
  tableRows.value = []
  tableColumns.value = []
  lastQuery = sqlQuery.value
  try {
    const res = await db.value?.query(sqlQuery.value)
    queryResult.value = res?.rows ?? null

    // Tabular check: non-empty array of plain objects with same keys
    if (
      Array.isArray(res?.rows) &&
      res.rows.length > 0 &&
      res.rows.every((r) => typeof r === 'object' && r !== null && !Array.isArray(r))
    ) {
      const firstRow = res.rows[0] as Record<string, unknown>
      const keys = Object.keys(firstRow)
      if (
        keys.length > 0 &&
        res.rows.every((r) => Object.keys(r as Record<string, unknown>).join() === keys.join())
      ) {
        tableRows.value = res.rows as Record<string, unknown>[]
        tableColumns.value = keys.map((k) => ({
          name: k,
          label: k,
          field: k,
          sortable: true,
        }))
        isTabularResult.value = true
        activeTab.value = 'table'
      } else {
        isTabularResult.value = false
        activeTab.value = 'json'
      }
    } else {
      isTabularResult.value = false
      activeTab.value = 'json'
    }
  } catch (err) {
    queryResult.value = err instanceof Error ? err.message : String(err)
    isTabularResult.value = false
    activeTab.value = 'json'
  }
}

// SQL schema query (for AI, unchanged)
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
  WHERE table_schema = 'public'
  GROUP BY table_name
  ORDER BY table_name
) t;
`

const gettingStarted = {
  label: 'Example: Ask for stored data in debug table',
  md: `
<!--taskyon
role: user
name: debug table

-->

What data is stored in our debug table? can you get the keys from the json in the data column?

---

<!--taskyon
role: assistant
name: debug table
content:
  type: structured
  data: >
    Do we have to use a tool?: true

    describe your thoughts: The user wants to retrieve nested keys from the JSON
    data in the 'debugdb' table. To do this, I need to use a recursive CTE
    (Common Table Expression) to traverse the JSON structure. The \`jsonb_each\`
    function can be used to extract key-value pairs from a JSON object, and
    \`jsonb_object_keys\` can extract keys. I will use a recursive CTE to iterate
    through the JSON and extract all keys, including nested ones.

    use tool: true

    which tool: setSqlQuery

    command:
      name: setSqlQuery
      arguments:
        sql: |-
          WITH RECURSIVE extract_keys AS (
              SELECT
                  key,
                  value
              FROM
                  debugdb,
                  jsonb_each(data) AS kv
              UNION ALL
              SELECT
                  (k.key || '.' || nk.key)::text,
                  nk.value
              FROM
                  extract_keys AS k,
                  jsonb_each(k.value) AS nk
              WHERE
                  jsonb_typeof(k.value) = 'object'
          )
          SELECT DISTINCT
              key
          FROM
              extract_keys;
parentID: aL0p70ca71SxefZethav_udZV__5d7TQqhymj7bcVrM

-->

---

<!--taskyon
role: function
name: debug table
content:
  type: functioncall
  data:
    name: setSqlQuery
    arguments:
      sql: |-
        WITH RECURSIVE extract_keys AS (
            SELECT
                key,
                value
            FROM
                debugdb,
                jsonb_each(data) AS kv
            UNION ALL
            SELECT
                (k.key || '.' || nk.key)::text,
                nk.value
            FROM
                extract_keys AS k,
                jsonb_each(k.value) AS nk
            WHERE
                jsonb_typeof(k.value) = 'object'
        )
        SELECT DISTINCT
            key
        FROM
            extract_keys;
parentID: aL0p70ca71SxefZethav_udZV__5d7TQqhymj7bcVrM

-->

---

<!--taskyon
role: assistant
name: SELECT DISTINCT key
parentID: GliNrcck0EvDEHOq_5KO8LU1X0gt6Bpf3xVWiI-v4X4

-->

The SQL query has been updated to:
\`\`\`sql
WITH RECURSIVE extract_keys AS (
    SELECT
        key,
        value
    FROM
        debugdb,
        jsonb_each(data) AS kv
    UNION ALL
    SELECT
        (k.key || '.' || nk.key)::text,
        nk.value
    FROM
        extract_keys AS k,
        jsonb_each(k.value) AS nk
    WHERE
        jsonb_typeof(k.value) = 'object'
)
SELECT DISTINCT
    key
FROM
    extract_keys;
\`\`\`
        `,
}

// Mount: init DB and Taskyon tools (unchanged)
onMounted(() => {
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

The last executed query and its results are:

\`\`\`sql
${lastQuery}
\`\`\`

\`\`\`json
    ${dump(queryResult.value)}
\`\`\`

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
      //selectedApi: 'taskyon',
      enableOpenAiTools: false,
      enableToolChooser: true,
      entryNode: toolCall({ name: 'setSqlQuery', arguments: {} }),
    },
    appConfiguration: {
      guiMode: 'minChat',
      showLogo: false,
      chatSuggestions: [gettingStarted],
      welcomeMsg: 'Ask taskyon for help on querying your database!',
    },
    signatureOrKey: state.activeTaskyonToken,
  }
  void initializeTaskyon({ tools, configuration, name: 'sqlqueries', persist: true })
})

// Formatted JSON result for JSON view
const formattedResult = computed(() => JSON.stringify(queryResult.value, null, 2))
</script>
