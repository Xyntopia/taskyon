<template>
  <q-page>
    <q-toolbar>
      <q-tabs v-model="selectedTab" class="col-auto" dense no-caps>
        <q-route-tab
          to="/settings/aiserviceprovider"
          label="AI Service Provider"
          name="aiserviceprovider"
        />
        <q-route-tab to="/settings/profile" label="Profile & Backup" name="profile" />
        <q-route-tab to="/settings/secrets" label="Secrets" name="secrets" />
        <q-route-tab
          v-if="state.appConfiguration.expertMode || selectedTab == 'agent config'"
          to="/settings/agent config"
          label="AI Configuration"
          name="agent config"
        />
        <q-route-tab
          v-if="state.appConfiguration.expertMode || selectedTab == 'app config'"
          to="/settings/app config"
          label="App Configuration"
          name="app config"
        />
      </q-tabs>
    </q-toolbar>
    <div class="fit text-center"><ExpertEnable /></div>
    <q-card flat class="q-ma-xs">
      <q-tab-panels :model-value="selectedTab" animated swipeable infinite>
        <q-tab-panel name="aiserviceprovider" :class="tabPanelClass">
          <LLMProviders
            v-model:expert-mode-on="state.appConfiguration.expertMode"
            style="max-width: 600px"
          />
        </q-tab-panel>
        <q-tab-panel name="profile" :class="tabPanelClass">
          <SyncTaskyon style="max-width: 600px" />
        </q-tab-panel>
        <q-tab-panel name="secrets" :class="tabPanelClass">
          <PasswordManager style="max-width: 600px" />
        </q-tab-panel>
        <q-tab-panel name="agent config" :class="tabPanelClass">
          <div>All of the Agent configuration</div>
          <ObjectTreeView
            v-model="state.llmSettings"
            :schema="
              convertZodToJsonSchemaCached(TyProfile.shape.llmSettings, {
                unrepresentable: 'any',
              })
            "
            class="fit"
          />
          <!--{{ state.llmSettings }}-->
        </q-tab-panel>
        <q-tab-panel name="app config" :class="tabPanelClass">
          <div>All of the app configurations</div>
          <ObjectTreeView
            v-model="state.appConfiguration"
            :schema="
              convertZodToJsonSchemaCached(TyProfile.shape.appConfiguration, {
                unrepresentable: 'any',
              })
            "
            class="fit"
          />
        </q-tab-panel>
      </q-tab-panels>
    </q-card>
  </q-page>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import LLMProviders from 'components/taskyon/LLMProviders.vue'
import ObjectTreeView from 'components/ObjectTreeView.vue'
import SyncTaskyon from 'components/taskyon/SyncTaskyon.vue'
import { useRoute } from 'vue-router'
import ExpertEnable from 'components/taskyon/ExpertEnable.vue'
import { useAppStateStore } from 'src/stores/appState'
import { convertZodToJsonSchemaCached, TyProfile } from 'src/modules/taskyon/types'
import PasswordManager from 'src/components/taskyon/PasswordManager.vue'

const route = useRoute()
const state = useAppStateStore()

const tabPanelClass = 'column items-center'

const selectedTab = computed(() => {
  return (route.params.tab as string) || 'aiserviceprovider'
})
</script>
