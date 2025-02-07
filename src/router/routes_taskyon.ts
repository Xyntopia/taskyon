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
        path: 'browser',
        component: defineAsyncComponent({
          loader: () => import('pages/taskyon/TaskChat.vue'),
          loadingComponent: LoadCircle,
          delay: 200,
        }),
        meta: { title: 'Main', description: 'Task Browser' },
        props: { browserMode: true },
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
  {
    path: '/ipfsmonitor',
    component: () => import('pages/taskyon/IpfsStatusPage.vue'),
    meta: {
      title: 'IPFS status',
      description: 'Interplanetary file system status monitor',
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
    path: '/p2pmonitor',
    component: () => import('pages/taskyon/Libp2pStatusPage.vue'),
    meta: {
      title: 'p2p connection status',
      description: 'libp2p connection status monitor',
    },
  },
]

export const routes: RouteRecordRaw[] = [
  ...taskyonRoutes,
  {
    // we are making sure to only load urls without any extensions here...
    path: '/authreturngit', // we can declare new routes for different service and extract the access tokens from the return parameters
    component: () => import('pages/auth/AuthReturnPage.vue'),
    props: (route) => ({
      accessToken: route.query, // whatever we find in the URL here :)
    }),
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
