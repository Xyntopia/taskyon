<!-- Sidebar -->
<template>
  <q-list dense>
    <q-item
      v-for="t in conversationThread"
      :key="t"
      v-ripple
      clickable
      @click="scrollToElement(`#${t.id}`)"
    >
      <q-item-section>
        {{ t.name }}
      </q-item-section>
    </q-item>
  </q-list>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue';
import { useTaskyonStore } from 'stores/taskyonState';
import { scroll } from 'quasar';
const { getScrollTarget, setVerticalScrollPosition } = scroll;

const state = useTaskyonStore();

function scrollToElement(id: string) {
  //const el = document.getElementById(id) // .parentNode.parentNode.parentNode
  const el = document.querySelector(id);
  const top = document.getElementsByClassName('q-page')[0];
  if (el && top) {
    const target = getScrollTarget(el);
    const offset =
      el.getBoundingClientRect().top - top.getBoundingClientRect().top;
    // const offset = el.offsetTop + 3 + curPos
    const duration = 200;
    setVerticalScrollPosition(target, offset, duration);
  }
}

type taskEntry = { id: string; name: string | undefined };
const conversationThread = ref<taskEntry[]>([]);

async function updateToc(newTaskId: string) {
  const tm = await state.getTaskManager();
  const tasks = await tm.getTaskChain(newTaskId);
  const toc = tasks
    .filter((t) => t?.name)
    .map((t) => {
      return { id: CSS.escape(t!.id), name: t!.name };
    });
  conversationThread.value = toc;
}

if (state.llmSettings.selectedTaskId) {
  updateToc(state.llmSettings.selectedTaskId);
}

watch(
  () => state.llmSettings.selectedTaskId,
  async (newTaskId) => {
    if (newTaskId) {
      updateToc(newTaskId);
    }
  },
);
</script>
