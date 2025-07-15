<template>
  <q-list dense>
    <q-item v-for="(secretRow, secretId) in secretList" :key="secretId">
      <q-expansion-item
        dense
        :label="secretId.split(':')[0]"
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
    </q-item>
  </q-list>
</template>

<script setup lang="ts">
import { useTaskyonStore } from 'src/stores/taskyonState'
import SecretInput from '../SecretInput.vue'
import { matDeleteForever, matSave } from '@quasar/extras/material-icons'
import { onMounted, ref } from 'vue'

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

// only called on Enter or Save‑button
const saveSecret = async (secretId: string, secretName: string) => {
  const newVal = secretList.value[secretId]![secretName]
  if (newVal) await tystate.secretStore.setSecret(secretId, secretName, newVal)
  // optional: refocus or toast here
  await loadSecrets()
}
</script>
