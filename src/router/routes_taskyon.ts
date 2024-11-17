import { RouteRecordRaw } from 'vue-router';
import { authRoutes, mdRoutes } from './routes_default';
import { defineAsyncComponent } from 'vue';
import LoadCircle from 'components/LoadingCircle.vue';

export const taskyonRoutes: RouteRecordRaw[] = [
  {
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
      },
      {
        // TODO: rename this and all references to search?
        path: 'taskmanager',
        component: defineAsyncComponent(
          () => import('pages/taskyon/TaskManager.vue'),
        ),
        meta: { title: 'Task Manager', description: 'Manage Tasks & Chats' },
        props: (route) => {
          console.log('open', route);
          return { query: route.query };
        },
      },
      {
        path: 'chat/',
        component: defineAsyncComponent({
          loader: () => import('pages/taskyon/TaskChat.vue'),
          loadingComponent: LoadCircle,
          delay: 200,
        }),
        meta: { title: 'Main', description: 'Taskyon AI Chat Companion' },
      },
      {
        // TODO:  change this, so that we can use "arbitrary" files for this!!!
        path: '/chat/:filePath([^.]*)*',
        component: defineAsyncComponent({
          loader: () => import('pages/taskyon/TaskChat.vue'),
          loadingComponent: LoadCircle,
          delay: 200,
        }),
        meta: { title: 'Chat', description: 'Taskyon AI Chat Companion' },
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
      // mdRoutes should have our normal taskyon layout thats why we put them in here :)
      ...mdRoutes,
    ],
  },
  {
    path: '/diagnostics',
    component: () => import('pages/taskyon/DiagnosticsPage.vue'),
    meta: {
      title: 'Diagnostics',
      description: 'Error & Diagnostics display',
    },
  },
  {
    path: '/tools',
    component: () => import('src/layouts/ToolManager.vue'),
    meta: { title: 'Tool Manager', description: 'Create & Manage AI Tools' },
  },
  {
    path: '/integration',
    component: () => import('src/layouts/ToolManager.vue'),
    meta: { title: 'Integration', description: 'Integrate Tasyon' },
  },
];

const routes: RouteRecordRaw[] = [
  ...taskyonRoutes,
  ...authRoutes,

  // Always leave this as last one,
  // but you can also remove it
  {
    path: '/:catchAll(.*)*',
    component: () => import('src/pages/Error404Page.vue'),
    meta: { title: 'ERROR', description: 'Page does not exist' },
  },
];

export default routes;
