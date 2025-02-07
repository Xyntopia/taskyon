<template>
  <q-layout view="lHh LpR lfr">
    <q-page-container>
      <q-page class="q-pa-md">
        <q-card>
          <q-card-section>
            <div class="text-h6">PGLite SQL Executor</div>
          </q-card-section>

          <div>all tables: {{ allTables }}</div>

          <!-- SQL Query Input -->
          <q-card-section>
            <q-input
              v-model="sqlQuery"
              label="SQL Query"
              type="textarea"
              autogrow
              dense
              placeholder="Enter your SQL query here"
              rows="3"
            />
            <div class="q-mt-md">
              <q-btn label="Run Query" @click="executeQuery" color="primary" />
            </div>
          </q-card-section>

          <!-- Query Results -->
          <q-card-section v-if="queryResult">
            <div class="text-h6">Results</div>
            <pre>{{ formattedResult }}</pre>
          </q-card-section>

          <!-- Error Message -->
          <q-card-section v-if="errorMessage" class="text-negative">
            <div class="text-h6">Error</div>
            <pre>{{ errorMessage }}</pre>
          </q-card-section>
        </q-card>
      </q-page>
    </q-page-container>
  </q-layout>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { getDatabase, type TyPGDB } from 'src/modules/pglite.api'
import { asyncComputed } from 'src/stores/vueUtils'

// --- Reactive State ---
const sqlQuery = ref('SELECT * FROM my_table;')
const queryResult = ref<unknown>(null)
const errorMessage = ref('')

// References to the database and our CRUD wrapper
const db = ref<TyPGDB | undefined>()

const allTables = asyncComputed(async () => {
  if (db.value) {
    return db.value?.query(
      "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public';",
    )
  }
  return []
}, [])

onMounted(async () => {
  try {
    db.value = await getDatabase('taskyon')
    // Ensure that the query method is bound to the db instance
    if (db.value && typeof db.value.query === 'function') {
      db.value.query = db.value.query.bind(db.value)
    }
  } catch (error) {
    console.error('Database initialization error:', error)
    errorMessage.value = error instanceof Error ? error.message : String(error)
  }
})

// --- SQL Query Execution ---
// This function executes any SQL query the user enters.
const executeQuery = async () => {
  errorMessage.value = ''
  queryResult.value = null
  try {
    // Execute the query using the pglite database's query() method.
    // This works because your CRUD wrapper uses db.query() underneath.
    const result = await db.value?.query(sqlQuery.value)
    queryResult.value = result?.rows
  } catch (error) {
    console.error('Query execution error:', error)
    errorMessage.value = error instanceof Error ? error.message : String(error)
  }
}

// A computed property for pretty-printing the result
const formattedResult = computed(() => {
  return JSON.stringify(queryResult.value, null, 2)
})
</script>

<style scoped>
pre {
  background-color: #f5f5f5;
  padding: 1rem;
  overflow-x: auto;
  border-radius: 4px;
}
</style>
