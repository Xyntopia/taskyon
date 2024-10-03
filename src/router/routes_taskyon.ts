import { RouteRecordRaw } from 'vue-router';
import { mdRoutes } from './routes_default';
import { defineAsyncComponent } from 'vue';
import LoadCircle from 'components/LoadingCircle.vue';

export const taskyonRoutes = {
  path: '/',
  component: () => import('layouts/TaskyonLayout.vue'),
  children: [
    {
      path: '',
      //component: defineAsyncComponent(() => import('pages/TaskChat.vue')),
      component: defineAsyncComponent({
        loader: () => import('pages/taskyon/TaskChat.vue'),
        loadingComponent: LoadCircle,
        delay: 200,
      }),
      meta: { title: 'Main', description: 'Taskyon AI Chat Companion' },
      /*component: defineAsyncComponent({
        loader: () => import('pages/TaskChat.vue'),
        loadingComponent: () => import('components/Loading.vue'),
      }),*/
    },
    {
      path: 'taskmanager',
      component: defineAsyncComponent(
        () => import('pages/taskyon/TaskManager.vue'),
      ),
      meta: { title: 'Task Manager', description: 'Manage Tasks & Chats' },
    },
    {
      path: 'chat',
      component: defineAsyncComponent(
        () => import('pages/taskyon/TaskChat.vue'),
      ),
      meta: { title: 'Main', description: 'Taskyon AI Chat Companion' },
    },
    {
      path: 'settings/:tab?',
      component: () => import('pages/taskyon/SettingsPage.vue'),
      meta: { title: 'Settings', description: 'Taskyon AI Chat Companion' },
    },
    {
      path: 'pricing',
      component: () => import('pages/taskyon/PricePage.vue'),
      meta: {
        title: 'Model List',
        description: 'Model capabilities and pricing information',
      },
    },
    {
      path: 'diagnostics',
      component: () => import('pages/taskyon/DiagnosticsPage.vue'),
      meta: {
        title: 'Diagnostics',
        description: 'Error & Diagnostics display',
      },
    },
    {
      path: 'tools',
      component: () => import('components/taskyon/ToolManager.vue'),
      meta: { title: 'Tool Manager', description: 'Create & Manage AI Tools' },
    },
    {
      path: 'prompts',
      component: () => import('pages/taskyon/PromptManager.vue'),
      meta: {
        title: 'Prompt Editor',
        description: 'Create & Manage AI Prompts',
      },
    },
    {
      path: 'docindex',
      component: () => import('pages/DocumentationIndex.vue'),
      meta: { title: 'Documentation', description: 'Taskyon Documentation' },
    },
    ...mdRoutes,
  ],
};

const routes: RouteRecordRaw[] = [
  taskyonRoutes,

  // Always leave this as last one,
  // but you can also remove it
  {
    path: '/:catchAll(.*)*',
    component: () => import('src/pages/Error404Page.vue'),
    meta: { title: 'ERROR', description: 'Page does not exist' },
  },
];

export default routes;
