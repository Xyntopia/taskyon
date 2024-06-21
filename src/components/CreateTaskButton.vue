<template>
  <q-btn v-bind="$attrs" no-caps :label="mainTask?.name"> </q-btn>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue';
import { load } from 'js-yaml';
import { LLMTask, partialTaskDraft } from 'src/modules/taskyon/types';
import type { SafeParseSuccess, SafeParseReturnType } from 'zod';

const props = defineProps<{
  markdown: string;
}>();

// Fetch, split, and parse the markdown file
function fetchAndProcessMarkdown(
  markdown: string
) /*: Promise<partialTaskDraft[]>*/ {
  // Split the markdown content by the separator
  const messages = markdown.split('---').map((message) => message.trim());

  // Regular expression for matching metadata
  const metadataRegex = /<!--taskyon([\s\S]*?)-->/;

  // Extract metadata and content from each message
  const parsedData = messages.map((message) => {
    const metadataMatch = metadataRegex.exec(message);
    const metadata = (
      metadataMatch ? load(metadataMatch[1].trim()) : {}
    ) as Record<string, unknown>;
    const content = message.replace(metadataRegex, '').trim();
    const task = partialTaskDraft.safeParse({
      content: { message: content },
      ...metadata,
    });
    return task;
  });

  const tasks = parsedData
    .filter((x): x is (typeof parsedData)[0] & { success: true } => x.success)
    .map((x) => x.data);

  return tasks;
}

const taskList = computed(() => fetchAndProcessMarkdown(props.markdown));
const mainTask = computed(() => {
  return taskList.value[0] as LLMTask | undefined;
});
</script>
