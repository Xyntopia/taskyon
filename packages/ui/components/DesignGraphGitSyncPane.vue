<template>
  <div class="git-sync-pane fit column no-wrap q-pa-md">
    <div class="row items-start no-wrap q-gutter-sm">
      <q-icon :name="matSync" size="sm" color="secondary" />
      <div>
        <div class="text-subtitle1">Git synchronization</div>
        <div class="text-caption text-grey-7">
          {{ scopeLabel }} · StorageClient remains the authoritative working copy.
        </div>
      </div>
    </div>

    <q-form class="git-sync-form q-mt-md" @submit="runSynchronization">
      <q-input
        :model-value="settings.remoteUrl"
        outlined
        dense
        label="Git repository URL"
        placeholder="https://github.com/organization/repository.git"
        @update:model-value="updateSetting('remoteUrl', String($event ?? ''))"
      />
      <div class="row q-col-gutter-sm">
        <q-input
          :model-value="settings.branch"
          class="col-12 col-sm-4"
          outlined
          dense
          label="Branch"
          @update:model-value="updateSetting('branch', String($event ?? ''))"
        />
        <q-input
          :model-value="settings.authorName"
          class="col-12 col-sm-4"
          outlined
          dense
          label="Commit author"
          @update:model-value="updateSetting('authorName', String($event ?? ''))"
        />
        <q-input
          :model-value="settings.authorEmail"
          class="col-12 col-sm-4"
          outlined
          dense
          type="email"
          label="Author email"
          @update:model-value="updateSetting('authorEmail', String($event ?? ''))"
        />
      </div>
      <q-input
        :model-value="settings.commitMessage"
        outlined
        dense
        label="Commit message"
        @update:model-value="updateSetting('commitMessage', String($event ?? ''))"
      />
      <q-expansion-item dense label="Authentication and browser network settings">
        <div class="column q-gutter-sm q-pt-sm">
          <q-input v-model="username" outlined dense autocomplete="username" label="Username" />
          <q-input
            v-model="password"
            outlined
            dense
            type="password"
            autocomplete="current-password"
            label="Password or access token"
            hint="Credentials are used for this synchronization only and are not stored."
          />
          <q-input
            :model-value="settings.corsProxy"
            outlined
            dense
            label="CORS proxy (optional)"
            @update:model-value="updateSetting('corsProxy', String($event ?? ''))"
          />
        </div>
      </q-expansion-item>

      <q-banner v-if="message" dense rounded :class="messageClass">
        <template #avatar>
          <q-icon :name="status === 'error' || status === 'conflict' ? matWarning : matCloudDone" />
        </template>
        {{ message }}
      </q-banner>

      <div class="row items-center q-gutter-sm">
        <q-btn
          type="submit"
          unelevated
          color="secondary"
          :icon="matSync"
          label="Synchronize now"
          :loading="status === 'synchronizing'"
          :disable="!canSynchronize"
        />
        <div class="text-caption text-grey-7">
          Definitions and metadata are synchronized; secrets, UI state, caches, and result blobs are
          excluded.
        </div>
      </div>
    </q-form>
  </div>
</template>

<script setup lang="ts">
import { matCloudDone, matSync, matWarning } from '@quasar/extras/material-icons'
import { computed, ref } from 'vue'

const props = defineProps<{
  scopeLabel: string
  settings: {
    remoteUrl: string
    branch: string
    authorName: string
    authorEmail: string
    commitMessage: string
    corsProxy: string
  }
  synchronize: (credentials?: { username: string; password: string }) => Promise<{
    status: 'unchanged' | 'pulled' | 'pushed' | 'conflict'
    exported: number
    imported: number
  }>
}>()

const emit = defineEmits<{
  updateSettings: [settings: typeof props.settings]
}>()

const username = ref('')
const password = ref('')
const status = ref<
  'idle' | 'synchronizing' | 'unchanged' | 'pulled' | 'pushed' | 'conflict' | 'error'
>('idle')
const message = ref('')
const canSynchronize = computed(
  () =>
    Boolean(props.settings.remoteUrl.trim()) &&
    Boolean(props.settings.branch.trim()) &&
    Boolean(props.settings.authorName.trim()) &&
    Boolean(props.settings.authorEmail.trim()) &&
    Boolean(props.settings.commitMessage.trim()),
)
const messageClass = computed(() =>
  status.value === 'error' || status.value === 'conflict'
    ? 'bg-negative text-white'
    : 'bg-positive text-white',
)

const updateSetting = (key: keyof typeof props.settings, value: string) => {
  emit('updateSettings', { ...props.settings, [key]: value })
}

const runSynchronization = async () => {
  if (!canSynchronize.value || status.value === 'synchronizing') return
  status.value = 'synchronizing'
  message.value = ''
  try {
    const credentials =
      username.value && password.value
        ? { username: username.value, password: password.value }
        : undefined
    const result = await props.synchronize(credentials)
    status.value = result.status
    message.value =
      result.status === 'conflict'
        ? 'The local and remote histories diverged. Nothing was overwritten.'
        : `${result.status === 'unchanged' ? 'Already synchronized' : result.status}. ` +
          `${result.exported} files exported, ${result.imported} imported.`
  } catch (error) {
    status.value = 'error'
    message.value = error instanceof Error ? error.message : String(error)
  }
}
</script>

<style scoped>
.git-sync-pane {
  min-width: 0;
  min-height: 0;
  overflow: auto;
}

.git-sync-form {
  display: grid;
  gap: 12px;
  width: min(760px, 100%);
}
</style>
