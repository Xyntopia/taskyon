<template>
  <q-btn
    id="ty-space-menu"
    round
    flat
    dense
    :size="btnSize"
    icon="svguse:/taskyon_mono_opt.svg#taskyon"
  >
    <q-menu>
      <q-list dense>
        <q-item :size="btnSize" to="/settings" data-cy="open-settings">
          <q-item-section avatar>
            <q-icon :name="matSettings" />
          </q-item-section>
          <q-item-section>Open settings</q-item-section>
        </q-item>
        <q-item v-ripple clickable href="https://github.com/xyntopia/taskyon" target="_blank" exact>
          <q-item-section avatar>
            <q-icon :name="mdiGithub" />
          </q-item-section>
          <q-item-section>Visit our Taskyon repository</q-item-section>
        </q-item>
        <q-separator />
        <q-item v-ripple clickable to="/docs/taskyon" exact active-class="text-secondary">
          <q-item-section avatar>
            <q-icon :name="matHelpOutline" />
          </q-item-section>
          <q-item-section> Documentation </q-item-section>
        </q-item>
        <q-item
          v-ripple
          clickable
          exact
          active-class="text-secondary"
          @click="showAboutDialog = true"
        >
          <q-item-section avatar>
            <q-icon :name="mdiInformationVariant" />
          </q-item-section>
          <q-item-section> About </q-item-section>
        </q-item>
        <q-separator />
        <q-item v-ripple clickable to="/pricing" exact active-class="text-secondary">
          <q-item-section> AI chat price list </q-item-section>
        </q-item>
        <q-separator />
        <q-item>
          <q-item-section>
            <DarkModeButton
              v-if="state"
              dense
              flat
              label="Change Theme"
              :size="btnSize"
              @theme-changed="onThemeChanged"
            />
          </q-item-section>
        </q-item>
      </q-list>
    </q-menu>
  </q-btn>
  <TaskyonAboutDialog v-model="showAboutDialog" :commit-hash="commitHash" :build-time="buildTime">
    <template #actions>
      <q-btn flat color="secondary" to="/diagnostics">
        <div class="q-pr-md">Open Diagnostics</div>
        <q-icon :name="mdiWrench" />
        <q-icon :name="mdiHospital" size="md" />
      </q-btn>
      <q-btn flat label="Reset Settings" to="/settings/profile" />
    </template>
  </TaskyonAboutDialog>
</template>

<script setup lang="ts">
import { matHelpOutline, matSettings } from '@quasar/extras/material-icons'
import { mdiGithub, mdiHospital, mdiInformationVariant, mdiWrench } from '@quasar/extras/mdi-v6'
import { useAppStateStore } from 'src/stores/appState'
import { ref } from 'vue'
import DarkModeButton from '@taskyon/ui/components/DarkModeButton.vue'
import TaskyonAboutDialog from '@taskyon/ui/components/TaskyonAboutDialog.vue'

defineProps<{
  btnSize: 'md' | 'sm' | 'xs' | 'lg' | 'xl'
}>()

const showAboutDialog = ref(false)
const state = useAppStateStore()
const commitHash = process.env.COMMIT_HASH
const buildTime = process.env.PUBLISH_DATE
if (!commitHash || !buildTime) {
  throw new Error('Taskyon build metadata is missing.')
}

function onThemeChanged(newMode: boolean | 'auto') {
  state.appConfiguration.darkTheme = newMode
}
</script>
