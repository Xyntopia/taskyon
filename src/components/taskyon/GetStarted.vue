<template>
  <div class="text-h6 col-auto">
    <p v-if="state.appConfiguration.welcomeMsg" class="text-center welcome-message-text">
      {{ state.appConfiguration.welcomeMsg }}
    </p>
    <div class="row q-gutter-xs justify-center">
      <div
        v-for="s in state.appConfiguration.chatSuggestions"
        :key="s.label"
        class="col-auto task-button"
      >
        <CreateTaskButton
          v-if="'md' in s"
          :markdown="s.md"
          :label="s.label"
          outline
          no-caps
          style="height: 100%"
        />
        <q-btn
          v-else-if="s.url"
          :to="s.url.toString()"
          :label="s.label"
          outline
          no-caps
          style="height: 100%"
        />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { useAppStateStore } from 'src/stores/appState'
import CreateTaskButton from './CreateTaskButton.vue'

const state = useAppStateStore()
</script>
