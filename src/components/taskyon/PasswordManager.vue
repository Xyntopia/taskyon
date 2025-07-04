<template>
  <q-list dense>
    <q-item v-for="(secretRow, secretId) in secretList" :key="secretId">
      <q-expansion-item
        dense
        :label="String(secretId)"
        default-opened
        header-class="text-h6"
        class="fit"
      >
        <q-item v-for="(secretValue, secretName) in secretRow" :key="secretName">
          <SecretInput
            color="secondary"
            class="fit"
            dense
            filled
            :model-value="secretValue"
            :label="`${secretName}`"
            @keyup.enter="
              () => {
                console.log('pressed enter')
              }
            "
            @update:model-value="
              (value) => {
                console.log('switch key', value)
              }
            "
          >
          </SecretInput>
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
import { matDeleteForever } from '@quasar/extras/material-icons'
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
</script>
