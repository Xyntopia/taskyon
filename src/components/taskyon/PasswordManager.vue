<template>
  <q-list dense>
    <q-item v-for="(secretId, index) in secretList" :key="index">
      <q-expansion-item
        dense
        :label="String(index)"
        default-opened
        header-class="text-h6"
        class="fit"
      >
        <q-item v-for="(secretValue, secretName) in secretId" :key="secretName">
          <SecretInput
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
        </q-item>
      </q-expansion-item>
    </q-item>
  </q-list>
</template>

<script setup lang="ts">
import { asyncComputed } from 'src/modules/vueUtils'
import { useTaskyonStore } from 'src/stores/taskyonState'
import SecretInput from '../SecretInput.vue'

const tystate = useTaskyonStore()

const secretIdList = asyncComputed(tystate.secretStore.listSecretIds, [])

const secretList = asyncComputed(async () => {
  // gather [key, value] pairs in parallel
  const entries = await Promise.all(
    secretIdList.value.map(
      async (id) => [id.toString(), await tystate.secretStore.listSecrets(id)] as const,
    ),
  )
  // turn into a Record<string, string[]>
  return Object.fromEntries(entries)
}, {})
</script>
