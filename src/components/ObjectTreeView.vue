<template>
  <q-tree v-if="modelValue" :nodes="nodeTree" node-key="label">
    <template v-slot:body-text="prop">
      <div class="row">
        <div v-if="separateLabels" class="col-auto" style="min-width: 200px">
          {{ prop.node.label }}:
        </div>
        <q-input
          :disable="disableEdit"
          class="col"
          filled
          :label="prop.node.label"
          type="textarea"
          :debounce="debounce"
          :model-value="prop.node.value"
          @update:modelValue="(value) => updateValue(prop.node.path, value)"
        >
        </q-input>
      </div>
    </template>
    <template v-slot:header-none> </template>
    <template v-slot:body-list="prop">
      <div class="row">
        <div class="col-auto" style="min-width: 200px">
          {{ prop.node.label }}:
        </div>
        <json-input
          class="col"
          :model-value="prop.node.value"
          @update:modelValue="(value) => updateValue(prop.node.path, value)"
        />
      </div>
    </template>
    <template v-slot:body-string="prop">
      <div class="row">
        <div v-if="separateLabels" class="col-auto" style="min-width: 200px">
          {{ prop.node.label }}:
        </div>
        <q-input
          :disable="disableEdit"
          class="col"
          style="min-width: 200px"
          :label="prop.node.label"
          filled
          dense
          autogrow
          :debounce="debounce"
          :model-value="prop.node.value"
          @update:modelValue="(value) => updateValue(prop.node.path, value)"
        >
        </q-input>
      </div>
    </template>
    <template v-slot:header-boolean="prop">
      <q-toggle
        :disable="disableEdit"
        style="min-width: 200px"
        :label="prop.node.label"
        left-label
        color="secondary"
        :model-value="prop.node.value"
        @update:modelValue="(value) => updateValue(prop.node.path, value)"
      />
    </template>
  </q-tree>
  <div v-else>no input data!</div>
</template>

<script setup lang="ts">
import { computed, toRefs, PropType } from 'vue';
import { QTreeNode } from 'quasar';
import JsonInput from 'components/JsonInput.vue'; // Adjust the path as necessary

const props = defineProps({
  disableEdit: {
    type: Boolean,
    default: false,
  },
  modelValue: {
    type: Object as PropType<Record<string, unknown> | undefined>,
    required: true,
  },
  inputFieldBehavior: {
    type: String,
    default: 'auto' as 'auto' | 'textarea' | 'autogrow',
  },
  separateLabels: {
    type: Boolean,
    default: true,
  },
  debounce: {
    type: Number,
    default: 100,
  },
});

const { modelValue } = toRefs(props);
const treeObject = modelValue;

const updateValue = (keyPath: string[], value: unknown) => {
  if (treeObject.value) {
    let currentPart: Record<string, unknown> = treeObject.value;

    // Iterate over the keyPath to find the correct property to update
    for (let i = 0; i < keyPath.length - 1; i++) {
      currentPart = currentPart[keyPath[i]] as Record<string, unknown>;
    }

    // Update the value at the final key, with a type assertion
    currentPart[keyPath[keyPath.length - 1]] = value;
  }
};

const transformToTreeNodes = (
  obj: Record<string, unknown>,
  keyPath: string[] = []
): QTreeNode[] => {
  return Object.entries(obj)
    .map(([key, value]) => {
      const newPath = [...keyPath, key];
      if (
        typeof value === 'object' &&
        value !== null &&
        !Array.isArray(value)
      ) {
        return {
          label: key,
          key: newPath.join('.'),
          value: null, // Placeholder, not used for objects
          children: transformToTreeNodes(
            value as Record<string, unknown>,
            newPath
          ),
        };
      } else if (Array.isArray(value)) {
        return {
          label: key,
          key: newPath.join('.'),
          value: value, // Keep the original array
          path: newPath,
          body: 'list', // Indicate this is a list
          header: 'none',
        };
      } else if (typeof value === 'string') {
        const node: QTreeNode = {
          label: key,
          key: newPath.join('.'),
          value: value,
          path: newPath,
          header: 'none',
        };
        value.length < 100 &&
        !value.includes('\n') &&
        !(props.inputFieldBehavior === 'textarea')
          ? (node['body'] = 'string')
          : (node['body'] = 'text');
        return node;
      } else if (typeof value === 'boolean') {
        return {
          label: key,
          key: newPath.join('.'),
          value: value as string | boolean,
          path: newPath,
          header: 'boolean',
        };
      } else {
        return {
          label: key,
          key: newPath.join('.'),
          value: JSON.stringify(value),
          path: newPath,
          body: 'unknown',
        };
      }
    })
    .filter((x) => x != undefined);
};

const nodeTree = computed(() => {
  if (treeObject.value) {
    return transformToTreeNodes(treeObject.value);
  } else {
    return [];
  }
});
</script>
