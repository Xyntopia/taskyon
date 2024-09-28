<template>
  <q-btn v-bind="$attrs" no-caps @click="addTasks"> </q-btn>
</template>

<script setup lang="ts">
import { load } from 'js-yaml';
import { partialTaskDraft } from 'src/modules/taskyon/types';
import { addTask2Tree } from 'src/modules/taskyon/taskManager';
import { useTaskyonStore } from 'src/stores/taskyonState';

const state = useTaskyonStore();

const props = defineProps<{
  markdown?: string;
  markdownUrl?: URL;
  scrollToBottom?: boolean;
}>();

async function getMarkdown(url: URL) {
  // Fetch the markdown file from the URL
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch markdown file: ${response.statusText}`);
  }
  const mdString = await response.text();
  return mdString;
}

// Fetch, split, and parse the markdown file
function processMarkdown(markdown: string) /*: Promise<partialTaskDraft[]>*/ {
  console.log('add new tasks', markdown);
  // Split the markdown content by the separator
  const messages = markdown.split(/^---/gm).map((message) => message.trim());

  // Regular expression for matching metadata
  const metadataRegex = /<!--taskyon([\s\S]*?)-->/;

  // Extract metadata and content from each message
  const parsedData = messages.map((message) => {
    const metadataMatch = metadataRegex.exec(message);
    let metadata;
    if (metadataMatch && metadataMatch[1]) {
      metadata = (metadataMatch ? load(metadataMatch[1].trim()) : {}) as Record<
        string,
        unknown
      >;
    } else {
      metadata = {
        role: 'user',
      };
    }
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

async function addTasks() {
  let parentId: string | undefined = undefined;
  let markdown: string | undefined = undefined;
  if (props.markdown) {
    markdown = props.markdown;
  } else if (props.markdownUrl) {
    markdown = await getMarkdown(props.markdownUrl);
  }
  if (markdown) {
    const taskList = processMarkdown(markdown);
    for (const task of taskList) {
      parentId = await addTask2Tree(
        task,
        parentId, //parent
        await state.getTaskManager(),
        false, // should we execute the task? // only the last one obviously ;)
      );
      state.llmSettings.selectedTaskId = parentId;
      state.lockBottomScroll = props.scrollToBottom;
    }
  }
  // TODO: optionally execute the last task...
}
</script>
