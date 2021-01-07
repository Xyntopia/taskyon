
const routes = [
  {
    path: '/',
    component: () => import('layouts/MainLayout.vue'),
    children: [
      {
        path: 'component/:uid',
        name: 'component',
        component: () => import('pages/Component.vue'),
        meta: { access: 'public' }
      },
      { path: 'componardosettings', component: () => import('pages/ComponardoSettings.vue') },
      { path: 'scrapercontrolpanel', component: () => import('pages/ScraperControlPanel.vue') },
      { path: 'user', component: () => import('pages/UserProfile.vue') },
      {
        path: 'login',
        name: 'login',
        component: () => import('pages/Login.vue'),
        meta: { access: 'public' },
        props: route => ({ nextPage: route.query.next })
      }
    ]
  },

  // Always leave this as last one,
  // but you can also remove it
  {
    path: '*',
    component: () => import('pages/Error404.vue')
  }
]

switch (process.env.APPMODE) {
  case '2specs':
    routes[0].children.unshift({ path: '', redirect: 'extractcomponentdata' })
    break
  default:
    routes[0].children.unshift({ path: '', redirect: 'search' })
    break
}

if (process.env.EXTRACTOR) {
  console.log('extractor enabled!')
  routes[0].children.unshift(...[
    { path: 'extractcomponentdata', component: () => import('pages/ExtractComponentData.vue') },
    { path: 'task/:uid', name: 'task', component: () => import('pages/Task.vue') }
  ])
}

if (process.env.CONFIGURATOR) {
  console.log('configurator enabled!')
  routes[0].children.push(...[
    { path: 'configurator', component: () => import('pages/Configurator.vue') },
    {
      path: 'offerconfigurator',
      component: () => import('pages/OfferConfigurator.vue'),
      meta: { access: 'public' }
    },
    {
      path: 'productconfigurator/:uid',
      name: 'productconfigurator',
      component: () => import('pages/ProductConfigurator.vue'),
      meta: { access: 'public' }
    },
    { path: 'systemviewer', component: () => import('pages/Systemviewer.vue') },
    { path: 'projectsadmin', component: () => import('pages/ProjectsAdmin.vue') }])
}

if (process.env.SEARCH) {
  console.log('search enabled!')
  routes[0].children.push({
    path: 'search',
    component: () => import('pages/BasicSearch.vue'),
    props: route => ({
      searchPropsFromURL: { ...route.query }
    }),
    meta: { access: 'public' }
  })
}

if (process.env.DEV) {
  console.log('development mode!')
  routes[0].children.push({ path: 'sandbox', component: () => import('pages/Sandbox.vue') })
}

export default routes
