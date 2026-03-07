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
        <q-item v-ripple clickable to="/docs/index" exact active-class="text-secondary">
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
          <q-dialog v-model="showAboutDialog" auto-close>
            <q-card>
              <q-card-section class="text-h5">About Taskyon</q-card-section>
              <q-card-section>
                Taskyon is a local-first AI platform for personalized task management and seamless
                web integration. It ensures data security with local processing while offering
                powerful tools like task trees, function execution, and sandboxing. Learn more at
                taskyon.space.
              </q-card-section>
              <q-card-actions>
                <q-btn flat color="secondary" to="/diagnostics">
                  <div class="q-pr-md">Open Diagnostics</div>
                  <q-icon :name="mdiWrench"></q-icon>
                  <q-icon :name="mdiHospital" size="md"></q-icon>
                </q-btn>
                <q-btn flat label="Reset Settings" to="/settings/profile" />
              </q-card-actions>
              <q-card-section class="text-info" style="font-size: 0.75em">
                <div v-for="[name, value] of Object.entries(environmentInfo)" :key="name">
                  {{ name }}: {{ value }}
                </div>
              </q-card-section>
              <q-card-section>
                <p>
                  “This application uses <strong>Rumoca</strong>, a Modelica compiler written in
                  Rust compiled to WebAssembly. Rumoca is licensed under the Apache‑2.0 License.”
                </p>
                <p style="font-size: 0.8em; color: var(--q-color-info‑text)">
                  Rumoca — “A Modelica compiler written in Rust” (© 2024–2025 Condie, Woodbury,
                  Goppert, Andersson & contributors). See
                  <a href="https://github.com/condie‑etc/rumoca" target="_blank"
                    >https://github.com/…/rumoca</a
                  >
                  and the included Apache‑2.0 license for details.
                </p>
              </q-card-section>
            </q-card>
          </q-dialog>
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
              @theme-changed="(newMode) => (darkMode = newMode)"
            />
          </q-item-section>
        </q-item>
      </q-list>
    </q-menu>
  </q-btn>
</template>

<script setup lang="ts">
import { matHelpOutline, matSettings } from '@quasar/extras/material-icons'
import { mdiGithub, mdiHospital, mdiInformationVariant, mdiWrench } from '@quasar/extras/mdi-v6'
import { getEnvironmentInfo } from '../../../packages/shared/modules/utils'
import { useAppStateStore } from 'src/stores/appState'
import { ref } from 'vue'
import DarkModeButton from '../DarkModeButton.vue'

defineProps<{
  btnSize: 'md' | 'sm' | 'xs' | 'lg' | 'xl'
}>()

const darkMode = defineModel<boolean | 'auto'>()

const showAboutDialog = ref(false)
const state = useAppStateStore()
const environmentInfo = getEnvironmentInfo()
console.log(environmentInfo)
</script>
