import { type RouteRecordRaw } from 'vue-router'
import { mdRoutes } from './routes_default'
import { defineAsyncComponent } from 'vue'
import LoadCircle from 'components/LoadingCircle.vue'

export const universalTyRoutes: RouteRecordRaw[] = [
  {
    path: 'settings/:tab?',
    component: () => import('pages/taskyon/SettingsPage.vue'),
    meta: { title: 'Settings', description: 'Taskyon AI Chat Companion' },
  },
]

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
        path: 'chat',
        component: defineAsyncComponent({
          loader: () => import('pages/taskyon/TaskChat.vue'),
          loadingComponent: LoadCircle,
          delay: 200,
        }),
        meta: { title: 'Main', description: 'Taskyon AI Chat Companion' },
      },
      {
        path: 'detailed',
        component: defineAsyncComponent({
          loader: () => import('pages/taskyon/TaskChat.vue'),
          loadingComponent: LoadCircle,
          delay: 200,
        }),
        meta: { title: 'Detailed Chat', description: 'Detailed Chat' },
        props: { detailed: true },
      },
      {
        path: 'browser/:id',
        component: defineAsyncComponent({
          loader: () => import('pages/taskyon/TaskChat.vue'),
          loadingComponent: LoadCircle,
          delay: 200,
        }),
        meta: { title: 'Task Browser', description: 'Task Browser' },
        props: (route) => ({ treeBrowser: true, rootTaskId: route.params.id }),
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
        // TODO: rename this and all references to search?
        path: 'taskmanager',
        component: () => import('pages/taskyon/TaskManager.vue'),
        meta: { title: 'Task Manager', description: 'Manage Tasks & Chats' },
        props: (route) => {
          console.log('open', route)
          if (route.query) return { query: route.query }
        },
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
      ...universalTyRoutes,
    ],
  },
  {
    path: '/',
    component: () => import('layouts/EmptyLayout.vue'),
    children: [
      {
        path: 'editor',
        component: () => import('pages/taskyon/CodingPage.vue'),
        meta: {
          title: 'Taskyon Code Editor',
          description: 'Edit code together with AI',
        },
      },
      {
        path: '/sql',
        component: () => import('pages/taskyon/SqlQueryPage.vue'),
        meta: {
          title: 'SQL debugging',
          description: 'Do queries on taskyons databases using SQL',
        },
      },
      {
        path: '/tool',
        component: () => import('src/pages/taskyon/ToolPage.vue'),
        meta: { title: 'Tool Page', description: 'Use Individual Tool' },
        props: true,
      },
      {
        path: '/tool/:name',
        component: () => import('src/pages/taskyon/ToolPage.vue'),
        meta: { title: 'Tool Page', description: 'Use Individual Tool' },
        props: true,
      },
      {
        path: '/fm',
        component: () => import('pages/FileManagerPage.vue'),
        meta: {
          title: 'File Manager',
          description: 'Manage files saved in Taskyon OPFS.',
        },
      },
      {
        path: '/opfs',
        component: () => import('pages/FileManagerPage.vue'),
        meta: {
          title: 'Taskyon File Manager',
          description: 'Manage files saved in Taskyon OPFS.',
        },
      },
    ],
  },
  // diagnostics should stay in its own page in order to be as independent as possible
  // in case there are any errors in the rest of the app...
  {
    path: '/diagnostics',
    component: () => import('pages/taskyon/DiagnosticsPage.vue'),
    meta: {
      title: 'Diagnostics',
      description: 'Error & Diagnostics display',
    },
  },
  {
    path: '/ipfsmonitor',
    component: () => import('pages/taskyon/IpfsStatusPage.vue'),
    meta: {
      title: 'IPFS status',
      description: 'Interplanetary file system status monitor',
    },
  },
  {
    path: '/p2pmonitor',
    component: () => import('pages/taskyon/Libp2pStatusPage.vue'),
    meta: {
      title: 'p2p connection status',
      description: 'libp2p connection status monitor',
    },
  },
  {
    path: '/clienttest',
    component: () => import('pages/TaskyonClientTest.vue'),
    meta: {
      title: 'Taskyon Client Test',
      description: 'We are testing taskyons client library here.',
    },
  },
]

export const routes: RouteRecordRaw[] = [
  ...taskyonRoutes,
  {
    // we are making sure to only load urls without any extensions here...
    path: '/oauth/return',
    component: () => import('pages/auth/AuthFlow.vue'),
  },
  // Always leave this as last one,
  // but you can also remove it
  {
    path: '/:catchAll(.*)*',
    component: () => import('src/pages/Error404Page.vue'),
    meta: { title: 'ERROR', description: 'Page does not exist' },
  },
]

export const tyServerRoutes: RouteRecordRaw[] = [
  {
    path: '/',
    component: () => import('layouts/ServerControlLayout.vue'),
    children: [
      {
        path: '',
        //component: defineAsyncComponent(() => import('pages/TaskChat.vue')),
        component: defineAsyncComponent({
          loader: () => import('pages/taskyon/ServerControl.vue'),
          loadingComponent: LoadCircle,
          delay: 200,
        }),
        meta: { title: 'Main', description: 'Taskyon AI Server Control' },
      },
      ...universalTyRoutes,
    ],
  },
  // Always leave this as last one,
  // but you can also remove it
  {
    path: '/:catchAll(.*)*',
    component: () => import('src/pages/Error404Page.vue'),
    meta: { title: 'ERROR', description: 'Page does not exist' },
  },
]
