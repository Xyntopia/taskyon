<template>
  <q-btn
    :label="
      mode === 'all' ? 'Reset Taskyon' : mode === 'settings' ? 'Reset Settings' : 'Delete Tasks'
    "
    @click="showResetDialog = true"
    v-bind="$attrs"
  >
    <q-tooltip :delay="1000">
      {{
        mode === 'all'
          ? 'Reset chat history & settings & cache. (Only appears in local development mode)'
          : mode === 'settings'
            ? 'Reset settings & cache, but keep tasks'
            : 'Delete all tasks, but keep settings'
      }}
    </q-tooltip>
    <q-dialog v-model="showResetDialog">
      <q-card>
        <q-card-section>
          <div class="text-h6 text-red text-center">
            <q-icon :name="matWarning" size="md" />
            <p v-if="mode === 'settings'">Warning: Reset all Taskyon Settings</p>
            <p v-else-if="mode === 'tasks'">Warning: Delete Taskyon Chat Data</p>
            <p v-else>Warning: Completly Wipe out all Taskyon Data</p>
          </div>
        </q-card-section>
        <q-card-section class="q-pt-none">
          <p v-if="mode === 'settings'">
            <strong>Warning:</strong> This operation will permanently delete all Taskyon chat data.
            This action cannot be undone.
          </p>
          <p v-else-if="mode === 'tasks'">
            <strong>Warning:</strong> This operation will reset all taskyon settings. It will *not*
            delete any of your chats.
          </p>
          <p v-else>
            <strong>Warning:</strong> This operation will permanently delete all taskyon settings
            including chat data & app settings.
          </p>
          <p>
            Before proceeding, please make sure you have a backup of the settings. You can backup
            your data here:
            <q-btn dense flat color="secondary" label="Backup Settings" to="/settings/profile" />
          </p>
          <!--<p>
          If you're sure you want to delete all Taskyon chat data, enter "DELETE" in the field below to confirm:
        </p>
        <q-input v-model="deleteConfirmation" label="Confirmation" />-->
        </q-card-section>
        <q-card-actions align="right">
          <q-btn v-close-popup flat label="Cancel" />
          <q-btn
            v-close-popup
            flat
            label="Reset"
            color="negative"
            :icon="matDeleteForever"
            @click="onResetTaskyon"
          />
        </q-card-actions>
      </q-card>
    </q-dialog>
  </q-btn>
</template>

<script setup lang="ts">
import { matDeleteForever, matWarning } from '@quasar/extras/material-icons'
import { useAppStateStore } from 'src/stores/appState'
import { useTaskyonStore } from 'stores/taskyonState'
import { ref } from 'vue'

const showResetDialog = ref(false)

const props = defineProps<{
  mode: 'all' | 'settings' | 'tasks'
}>()

const state = useAppStateStore()
const tystate = useTaskyonStore()

async function onResetTaskyon() {
  console.log('reset taskyon!')
  if (props.mode !== 'settings') {
    const tm = await tystate.getTaskManager()
    await tm.deleteAllTasks()
    state.chatHistory = []
  }
  if (props.mode !== 'tasks') state.$reset()
  // TODO: this is a superdirty version..  it would be much better to manually reinit the taskyondb in the deleteAllTasks function
  location.reload() // reload browser window to reinitialize the db...
  //location.reload(); // reload browser window to reinitialize the db...
}
</script>
