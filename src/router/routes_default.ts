export const authRoutes = [
  {
    path: 'account',
    component: () => import('pages/auth/Account.vue'),
  },
  {
    path: 'auth',
    component: () => import('pages/auth/Account.vue'),
  },
];

export default authRoutes;
