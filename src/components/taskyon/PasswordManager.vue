<template>
  <div class="text-center">
    <InfoDialog
      v-if="title"
      :label="title"
      :round="false"
      class="q-mb-lg"
      :info-text="`
- Passwords are encrypted at all times except when needed for a tool.
- Tools can only see and modify the passwords created by themselves.
- Passwords will not leave your device unless you explicitly share them.
`"
    />
    <q-list dense separator>
      <div
        v-if="onlyThisKey && Object.keys(secretList[onlyThisKey] || {}).length == 0"
        class="text-negative"
      >
        There are no keys listed under {{ onlyThisKey }} in our Secret Store!
      </div>
      <q-item v-for="(secretRow, secretId) in secretList" v-else :key="secretId">
        <q-expansion-item
          dense
          :label="toolMap.t[secretId] ?? secretId.split(':')[0]"
          default-opened
          header-class="text-h6"
          class="fit"
          :icon="toolMap.t[secretId] ? mdiTools : undefined"
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
            <q-btn
              v-if="copybtn"
              flat
              :icon="matContentCopy"
              @click="copyToClipboard(secretList[secretId]![secretName])"
            />
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
          <q-btn
            v-if="toolMap.t[secretId]"
            flat
            label="Tool Manager"
            :to="'/tool/' + toolMap.t[secretId]"
          />
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
import { matContentCopy, matDeleteForever, matSave } from '@quasar/extras/material-icons'
import { onMounted, ref } from 'vue'
import { asyncComputed } from 'src/modules/vueUtils'
import { generateSecretId } from 'src/modules/taskyon/taskWorker'
import InfoDialog from '../InfoDialog.vue'
import { copyToClipboard } from 'src/modules/utils'
import { mdiTools } from '@quasar/extras/mdi-v6'
import { watch } from 'vue'

const { onlyThisKey } = defineProps<{
  title?: string
  copybtn?: boolean
  onlyThisKey?: string
}>()

const tystate = useTaskyonStore()
const secretList = ref<Record<string, Record<string, string>>>({})

// extract your loader into its own function
async function loadSecrets() {
  const ty = await tystate.taskyon
  if (onlyThisKey) {
    console.log('load secrets!', toolMap.value)
    const secs = await ty.listSecrets(onlyThisKey)
    if (secs) {
      secretList.value[onlyThisKey] = secs
    } else {
      // if we didn't find it search among the toolnames...
      const secId = toolMap.value.r[onlyThisKey]
      if (secId) {
        secretList.value[secId] = await ty.listSecrets(secId)
      }
    }
  } else {
    const ids = await ty.listSecretIds()
    const entries = await Promise.all(
      ids.map(async (id) => [id.toString(), await ty.listSecrets(id)] as const),
    )
    secretList.value = Object.fromEntries(entries)
  }
}

onMounted(loadSecrets)

const deleteSecrets = async (secretId: string, secretName: string) => {
  const ty = await tystate.taskyon
  await ty.deleteSecret(secretId, secretName)
  // force re-render
  await loadSecrets()
}

const deleteAllSecrets = async (secretId: string) => {
  const ty = await tystate.taskyon
  await ty.deleteAllFromId(secretId)
  await loadSecrets()
}

// only called on Enter or Save‑button
const saveSecret = async (secretId: string, secretName: string) => {
  const newVal = secretList.value[secretId]![secretName]
  const ty = await tystate.taskyon
  if (newVal) await ty.setSecret(secretId, secretName, newVal)
  // optional: refocus or toast here
  await loadSecrets()
}

const toolMap = asyncComputed(
  async () => {
    const ty = await tystate.taskyon
    const tools: Record<string, string> = {}
    const rtools: Record<string, string> = {}
    for (const c of Object.values(tystate.allTools)) {
      const { tool, def } = await ty.getToolDefinition(c.name)
      if (tool) {
        const id = await generateSecretId(def?.id, tool)
        tools[id] = def?.id ?? c.name
        rtools[c.name] = id
      }
    }
    return { t: tools, r: rtools }
  },
  { t: {}, r: {} },
  () => tystate.allTools,
)

watch(toolMap, loadSecrets)
</script>
