<template>
  <div class="text-center">
    <InfoDialog
      label="Taskyon Password Manager"
      :round="false"
      class="q-mb-lg"
      :info-text="`
- Passwords are encrypted at all times except when needed for a tool.
- Tools can only see and modify the passwords created by themselves.
- Passwords will not leave your device unless you explicitly share them.
`"
    />
    <q-list dense separato>
      <q-item v-for="(secretRow, secretId) in secretList" :key="secretId">
        <q-expansion-item
          dense
          :label="toolMap[secretId] ?? secretId.split(':')[0]"
          default-opened
          header-class="text-h6"
          class="fit"
        >
          <q-item v-for="(secretValue, secretName) in secretRow" :key="secretName">
            <SecretInput
              v-model="secretList[secretId]![secretName]!"
              color="secondary"
              class="fit"
              dense
              filled
              :label="`${secretName}`"
              style="min-width: 200px"
              @keyup.enter="saveSecret(secretId, secretName)"
            >
            </SecretInput>
            <q-btn flat :icon="matSave" @click="saveSecret(secretId, secretName)" />
            <q-btn
              flat
              color="negative"
              :icon="matDeleteForever"
              @click="deleteSecrets(secretId, secretName)"
            ></q-btn>
          </q-item>
        </q-expansion-item>
        <q-item-section side top>
          <q-btn flat label="Tool Manager" :to="'/tool/' + toolMap[secretId]" />
          <q-btn
            flat
            color="negative"
            label="delete all"
            @click="deleteAllSecrets(secretId)"
          ></q-btn>
        </q-item-section>
      </q-item>
    </q-list>
  </div>
</template>

<script setup lang="ts">
import { useTaskyonStore } from 'src/stores/taskyonState'
import SecretInput from '../SecretInput.vue'
import { matDeleteForever, matSave } from '@quasar/extras/material-icons'
import { onMounted, ref } from 'vue'
import { asyncComputed } from 'src/modules/vueUtils'
import { generateSecretId } from 'src/modules/taskyon/taskWorker'
import InfoDialog from '../InfoDialog.vue'

const tystate = useTaskyonStore()

// make this a mutable ref
const secretList = ref<Record<string, Record<string, string>>>({})

// extract your loader into its own function
async function loadSecrets() {
  const ids = await tystate.secretStore.listSecretIds()
  const entries = await Promise.all(
    ids.map(async (id) => [id.toString(), await tystate.secretStore.listSecrets(id)] as const),
  )
  secretList.value = Object.fromEntries(entries)
}

onMounted(loadSecrets)

const deleteSecrets = async (secretId: string, secretName: string) => {
  await tystate.secretStore.deleteSecret(secretId, secretName)
  // force re-render
  await loadSecrets()
}

const deleteAllSecrets = async (secretId: string) => {
  await tystate.secretStore.deleteAllFromId(secretId)
  await loadSecrets()
}

// only called on Enter or Save‑button
const saveSecret = async (secretId: string, secretName: string) => {
  const newVal = secretList.value[secretId]![secretName]
  if (newVal) await tystate.secretStore.setSecret(secretId, secretName, newVal)
  // optional: refocus or toast here
  await loadSecrets()
}

const toolMap = asyncComputed(async () => {
  const tm = await tystate.getTaskManager()
  const tools: Record<string, string> = {}
  for (const c of Object.values(tystate.allTools)) {
    const { tool, def } = await tm.getToolDefinition(c.name)
    if (tool) {
      const id = await generateSecretId(def?.id, tool)
      tools[id] = def?.id ?? c.name
    }
  }
  return tools
}, {})
</script>
