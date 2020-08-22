
const routes = [
  {
    path: '/',
    component: () => import('layouts/MainLayout.vue'),
    children: [
      { path: '', component: () => import('pages/BasicSearch.vue') },
      { path: 'configurator', component: () => import('pages/Configurator.vue') },
      { path: 'sandbox', component: () => import('pages/Sandbox.vue') },
      { path: 'systemviewer', component: () => import('pages/Systemviewer.vue') }
    ]
  },

  // Always leave this as last one,
  // but you can also remove it
  {
    path: '*',
    component: () => import('pages/Error404.vue')
  }
]

export default routes
