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
              <q-btn label="Run Query" color="primary" @click="executeQuery" />
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
import { ref, computed, onMounted, shallowRef } from 'vue'
import { getDatabase, type TyPGDB } from 'src/modules/pglite.api'
import { asyncComputed } from 'src/modules/vueUtils'

// --- Reactive State ---
const sqlQuery = ref('SELECT * FROM my_table;')
const queryResult = ref<unknown>(null)
const errorMessage = ref('')

// Use shallowRef so that Vue doesn't deeply proxy the db instance
const db = shallowRef<TyPGDB | undefined>()

// List of tables computed asynchronously
const allTables = asyncComputed(async () => {
  if (db.value) {
    const result = await db.value.query(
      "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public';",
    )
    // Return an array of table names
    return result.rows.map((row: unknown) => (row as { table_name: string }).table_name)
  }
  return []
}, [])

onMounted(async () => {
  try {
    // Initialize the pglite database.
    // Storing the instance in a shallowRef prevents Vue from wrapping its private fields.
    db.value = await getDatabase('taskyon')
  } catch (error) {
    console.error('Database initialization error:', error)
    errorMessage.value = error instanceof Error ? error.message : String(error)
  }
})

// --- SQL Query Execution ---
const executeQuery = async () => {
  errorMessage.value = ''
  queryResult.value = null
  try {
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
