<template>
  <q-tree v-if="modelValue" :nodes="nodeTree" node-key="label" v-bind="$attrs">
    <template #body-text="prop">
      <div class="row">
        <div v-if="separateLabels" class="col-auto" style="min-width: 200px">
          {{ prop.node.label }}:
        </div>
        <q-input
          :readonly="readOnly"
          class="col"
          filled
          :label="separateLabels ? undefined : prop.node.label"
          input-style="max-height: 300px"
          type="textarea"
          :debounce="debounce"
          :model-value="prop.node.value"
          @update:model-value="
            (value: unknown) => updateValue(prop.node.path, value)
          "
        >
        </q-input>
        <info-dialog
          v-if="descriptions[prop.node.path.join('.')] && !descriptionsAsLabels"
        >
          {{ descriptions[prop.node.path.join('.')] }}
        </info-dialog>
      </div>
    </template>
    <template #header-none> </template>
    <template #body-list="prop">
      <div class="row">
        <div class="col-auto" style="min-width: 200px">
          {{ prop.node.label }}:
        </div>
        <json-input
          :readonly="readOnly"
          class="col"
          :model-value="prop.node.value"
          @update:model-value="
            (value: unknown) => updateValue(prop.node.path, value)
          "
        />
        <info-dialog
          v-if="descriptions[prop.node.path.join('.')] && !descriptionsAsLabels"
        >
          {{ descriptions[prop.node.path.join('.')] }}
        </info-dialog>
      </div>
    </template>
    <template #body-string="prop">
      <div class="row">
        <div v-if="separateLabels" class="col-auto" style="min-width: 200px">
          {{ prop.node.label }}:
        </div>
        <q-input
          :readonly="readOnly"
          class="col"
          style="min-width: 200px"
          :label="separateLabels ? undefined : prop.node.label"
          filled
          dense
          autogrow
          :debounce="debounce"
          :model-value="prop.node.value"
          @update:model-value="
            (value: unknown) => updateValue(prop.node.path, value)
          "
        >
        </q-input>
        <info-dialog
          v-if="descriptions[prop.node.path.join('.')] && !descriptionsAsLabels"
        >
          {{ descriptions[prop.node.path.join('.')] }}
        </info-dialog>
      </div>
    </template>
    <template #header-boolean="prop">
      <q-toggle
        :readonly="readOnly"
        style="min-width: 200px"
        :label="prop.node.label"
        left-label
        color="secondary"
        :model-value="prop.node.value"
        @update:model-value="
          (value: unknown) => updateValue(prop.node.path, value)
        "
      >
      </q-toggle>
      <info-dialog
        v-if="descriptions[prop.node.path.join('.')] && !descriptionsAsLabels"
      >
        {{ descriptions[prop.node.path.join('.')] }}
      </info-dialog>
    </template>
    <template #body-number="prop">
      <div class="row">
        <div v-if="separateLabels" class="col-auto" style="min-width: 200px">
          {{ prop.node.label }}:
        </div>
        <q-input
          :readonly="readOnly"
          class="col"
          style="min-width: 200px"
          :label="separateLabels ? undefined : prop.node.label"
          filled
          dense
          type="number"
          :debounce="debounce"
          :model-value="prop.node.value"
          @update:model-value="
            (value: unknown) => updateValue(prop.node.path, value)
          "
        />
      </div>
      <info-dialog
        v-if="descriptions[prop.node.path.join('.')] && !descriptionsAsLabels"
      >
        {{ descriptions[prop.node.path.join('.')] }}
      </info-dialog>
    </template>
  </q-tree>
  <div v-else>no input data!</div>
</template>

<script setup lang="ts">
import { computed, toRefs, PropType } from 'vue';
import { QTreeNode } from 'quasar';
import JsonInput from 'components/JsonInput.vue'; // Adjust the path as necessary
import InfoDialog from 'components/InfoDialog.vue';

const props = defineProps({
  readOnly: {
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
  descriptions: {
    type: Object as PropType<Record<string, string>>,
    default: () => ({}),
  },
  descriptionsAsLabels: {
    type: Boolean,
    default: false,
  },
});

const { modelValue, descriptions } = toRefs(props);
const treeObject = modelValue;

const updateValue = (keyPath: string[], value: unknown) => {
  if (treeObject.value) {
    let currentPart: Record<string, unknown> = treeObject.value;

    // Iterate over the keyPath to find the correct property to update
    for (let i = 0; i < keyPath.length - 1; i++) {
      currentPart = currentPart[keyPath[i]!] as Record<string, unknown>;
    }

    // Update the value at the final key, with a type assertion
    currentPart[keyPath[keyPath.length - 1]!] = value;
  }
};

const transformToTreeNodes = (
  obj: Record<string, unknown>,
  keyPath: string[] = [],
): QTreeNode[] => {
  return Object.entries(obj)
    .map(([key, value]) => {
      const newPath = [...keyPath, key];
      let label = key;
      if (props.descriptionsAsLabels) {
        label = props.descriptions[newPath.join()] || key;
      }
      if (
        typeof value === 'object' &&
        value !== null &&
        !Array.isArray(value)
      ) {
        return {
          label,
          key: newPath.join('.'),
          value: null, // Placeholder, not used for objects
          children: transformToTreeNodes(
            value as Record<string, unknown>,
            newPath,
          ),
        };
      } else if (Array.isArray(value)) {
        return {
          label,
          key: newPath.join('.'),
          value, // Keep the original array
          path: newPath,
          body: 'list', // Indicate this is a list
          header: 'none',
        };
      } else if (typeof value === 'string') {
        const node: QTreeNode = {
          label,
          key: newPath.join('.'),
          value,
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
          label,
          key: newPath.join('.'),
          value: value as string | boolean,
          path: newPath,
          header: 'boolean',
        };
      } else if (typeof value === 'number') {
        return {
          label,
          key: newPath.join('.'),
          value,
          path: newPath,
          header: 'none',
          body: 'string', // or 'text' if you want to use a text input
        };
      } else {
        return {
          label,
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
