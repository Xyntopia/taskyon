<template>
  <q-layout view="hHh Lpr fFf">
    <TaskyonHeader btn-size="md" min-mode no-chat-button-border back-to-chat />
    <q-page-container>
      <!-- This is where pages get injected we do row & items-stretch in order for our widgets to fill the entire iframe..-->
      <router-view />
    </q-page-container>
  </q-layout>
</template>

<script setup lang="ts">
import TaskyonHeader from 'src/components/taskyon/TaskyonHeader.vue'
</script>
