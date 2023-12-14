<template>
  <q-layout view="hHh Lpr fFf">
    <q-header class="row bg-transparent">
      <!-- Be sure to play with the Layout demo on docs -->
      <q-btn
        flat
        dense
        size="xs"
        icon="launch"
        color="grey-6"
        type="a"
        href="/chat"
        target="_blank"
        label="Manage Chat Window"
      />
      <q-space />
      <q-btn
        flat
        dense
        size="xs"
        icon="launch"
        color="grey-6"
        type="a"
        href="http://www.xyntopia.com"
        target="_blank"
        aria-label="Visit Xyntopia"
        label="xyntopia.com"
      />
      <!--<q-img width="30px" src="~assets/xyntopia.svg" />-->
    </q-header>
    <q-page-container>
      <!-- This is where pages get injected we do row & items-stretch in order for our widgets to fill the entire iframe..-->
      <q-page>
        <router-view />
      </q-page>
    </q-page-container>
  </q-layout>
</template>

<script setup lang="ts">
//TODO: change colors based on the route...
import { useRoute } from 'vue-router';
const route = useRoute();
route.query; //has all the parameters :)
</script>
