<template>
  <div class="taskyon-workspace-shell">
    <aside
      class="taskyon-workspace-rail dock-tabs-header dock-tabs-header--left"
      :class="{ 'dock-tabs-header--compact': collapsed }"
      aria-label="Workspace navigation"
    >
      <button
        type="button"
        class="dock-tab-rail-toggle"
        :aria-label="collapsed ? 'Expand workspace navigation' : 'Compact workspace navigation'"
        :title="collapsed ? 'Expand workspace navigation' : 'Compact workspace navigation'"
        @click="emit('update:collapsed', !collapsed)"
      >
        <q-icon :name="collapsed ? 'keyboard_double_arrow_right' : 'keyboard_double_arrow_left'" />
      </button>

      <div class="taskyon-workspace-rail__header">
        <div v-if="!collapsed && label" class="taskyon-workspace-rail__title ellipsis">
          {{ label }}
        </div>
        <slot name="header-actions" :collapsed="collapsed" />
      </div>

      <div class="taskyon-workspace-rail__items" role="tablist" aria-orientation="vertical">
        <button
          v-for="item in items"
          :key="item.id"
          type="button"
          role="tab"
          class="dock-tab"
          :class="{ active: item.id === activeId }"
          :aria-selected="item.id === activeId"
          :aria-label="item.label"
          @click="emit('select', item.id)"
        >
          <q-icon v-if="item.icon" :name="item.icon" class="dock-tab-icon" />
          <span class="dock-tab-title ellipsis">{{ item.label }}</span>
          <q-tooltip
            v-if="collapsed"
            anchor="center right"
            self="center left"
            :offset="[0, 0]"
            :delay="0"
            :transition-duration="0"
            class="taskyon-workspace-tab-flyout"
          >
            {{ item.label }}
          </q-tooltip>
        </button>
      </div>

      <div class="taskyon-workspace-rail__footer">
        <slot name="footer" :collapsed="collapsed" />
      </div>
    </aside>

    <main class="taskyon-workspace-shell__content">
      <slot />
    </main>
  </div>
</template>

<script setup lang="ts">
const {
  items,
  activeId = undefined,
  label = 'Workspaces',
  collapsed = false,
} = defineProps<{
  items: readonly { id: string; label: string; icon?: string }[]
  activeId?: string
  label?: string
  collapsed?: boolean
}>()

const emit = defineEmits<{
  (event: 'select', id: string): void
  (event: 'update:collapsed', collapsed: boolean): void
}>()
</script>

<style scoped>
.taskyon-workspace-shell {
  display: flex;
  width: 100%;
  height: 100%;
  min-width: 0;
  min-height: 0;
  box-sizing: border-box;
  gap: var(--workspace-shell-gap, 0);
  padding: var(--workspace-shell-padding, 0);
}

.taskyon-workspace-rail {
  display: flex;
  flex: 0 0 var(--dock-tab-rail-width, 176px);
  flex-direction: column;
  width: var(--dock-tab-rail-width, 176px);
  min-width: var(--dock-tab-rail-width, 176px);
  padding-block: 0.25rem;
}

.taskyon-workspace-rail.dock-tabs-header--compact {
  flex-basis: var(--dock-tab-rail-compact-width, 52px);
  width: var(--dock-tab-rail-compact-width, 52px);
  min-width: var(--dock-tab-rail-compact-width, 52px);
}

.taskyon-workspace-rail__header,
.taskyon-workspace-rail__footer {
  display: flex;
  align-items: center;
  gap: 0.25rem;
  min-height: 40px;
  padding-inline: 0.4rem;
}

.taskyon-workspace-rail__title {
  flex: 1;
}

.taskyon-workspace-rail__items {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
}

.taskyon-workspace-rail .dock-tab {
  width: calc(100% - 0.75rem);
  min-height: 40px;
  justify-content: flex-start;
  margin: 0.125rem 0.375rem;
  padding-block: 0.125rem;
  border: 1px solid transparent;
  border-radius: 6px;
  text-align: left;
}

.taskyon-workspace-rail .dock-tab-icon {
  flex: 0 0 auto;
  margin-right: 0.5rem;
}

.taskyon-workspace-rail .dock-tab-title {
  text-align: left;
}

.taskyon-workspace-rail.dock-tabs-header--compact .dock-tab {
  width: calc(100% - 0.5rem);
  justify-content: center;
  margin-inline: 0.25rem;
  padding-inline: 0;
}

.taskyon-workspace-rail.dock-tabs-header--compact .dock-tab-icon {
  margin-right: 0;
}

.taskyon-workspace-rail.dock-tabs-header--compact .dock-tab-title,
.taskyon-workspace-rail.dock-tabs-header--compact .taskyon-workspace-rail__title {
  display: none;
}

.taskyon-workspace-rail.dock-tabs-header--compact .taskyon-workspace-rail__footer {
  flex-direction: column-reverse;
  align-items: center;
  padding-inline: 0.25rem;
}

.taskyon-workspace-rail.dock-tabs-header--compact .taskyon-workspace-rail__footer :deep(.q-btn) {
  max-width: 100%;
}

.taskyon-workspace-shell__content {
  flex: 1 1 auto;
  min-width: 0;
  min-height: 0;
}
</style>
