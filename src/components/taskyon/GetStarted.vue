<template>
  <div class="text-h6 col-auto">
    <p class="text-center welcome-message-text">
      Welcome! Just type a message below to start using Taskyon!
    </p>
    <div class="row q-gutter-xs justify-about">
      <div
        v-for="(s, idx) in state.appConfiguration.chatSuggestions"
        :key="idx"
        class="col task-button"
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
