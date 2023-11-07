<template>
  <q-list dense separator bordered v-if="selectedTool">
    <q-item>
      <q-item-section>
        <q-item-label> arguments (yaml): </q-item-label>
        <q-item-label caption><pre>{{
          dump(task.context?.function?.arguments)
        }}</pre></q-item-label>
      </q-item-section>
    </q-item>
    <q-item>
      <q-item-section>
        <q-item-label> result (yaml): </q-item-label>
        <q-item-label caption>
          <pre>
      {{ dump(task.result) }}
      </pre
          >
        </q-item-label>
      </q-item-section>
    </q-item>
  </q-list>
  <div v-else>
    <p>No tool selected</p>
  </div>
</template>

<script setup lang="ts">
import { ref, defineProps, defineEmits } from 'vue';
import { ExtendedTool, FunctionArguments } from 'src/modules/tools';
import { dump } from 'js-yaml';
import { LLMTask } from 'src/modules/types';

const props = defineProps<{
  task: LLMTask;
}>();

const emit = defineEmits<{
  (event: 'update:task', task: LLMTask): void;
  (event: 'execute-tool', tool: ExtendedTool): void;
}>();

const selectedTool = ref(props.task.context?.function);

const convertArgumentsToObject = (
  args: FunctionArguments
): Record<string, string> => {
  const result: Record<string, string> = {};

  if (typeof args === 'string' || typeof args === 'number') {
    // Convert number to string if necessary
    result.value = args.toString();
  } else if (typeof args === 'object' && args !== null) {
    // Iterate through the object properties
    for (const key in args) {
      const value = args[key];
      // Only keep string values or convert numbers to strings
      if (typeof value === 'string') {
        result[key] = value;
      } else if (typeof value === 'number') {
        result[key] = value.toString();
      }
      // Non-string, non-number values are dropped
    }
  }

  return result;
};

// Use the conversion function before defining parameters
const parameters = ref<Record<string, string>>(
  convertArgumentsToObject(selectedTool.value?.arguments || {})
);

const updateTool = (value: unknown, key: string) => {
  // Update the arguments of the selected tool
  console.log('update task parameters', value, key);
  /*if (selectedTool.value) {
    selectedTool.value.arguments[key] = value;
    // Create a copy of the task with updated function arguments
    const updatedTask: LLMTask = {
      ...props.task,
      context: {
        ...props.task.context,
        function: {
          ...selectedTool.value,
          arguments: { ...selectedTool.value.arguments },
        },
      },
    };
    // Emit an event to notify parent components about the updated task
    emit('update:task', updatedTask);
  }*/
};

/*const requestExecution = () => {
  emit('execute-tool', selectedTool.value);
};*/
</script>
