import { useAuthStore } from '@/stores/auth'; // 👈 make sure this path is correct
import { createRouter, createWebHistory } from 'vue-router'

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes: [
    { path: '/', redirect: '/dashboard' },
    {
      path: '/',
      component: () => import('../layouts/default.vue'),
      meta: { requiresAuth: true }, // 👈 Apply auth requirement here
      children: [
        { path: 'dashboard', component: () => import('../pages/dashboard.vue') },
        { path: 'inventory', component: () => import('../pages/inventory.vue') },
        { path: 'account-settings', component: () => import('../pages/account-settings.vue') },
        { path: 'typography', component: () => import('../pages/typography.vue') },
        { path: 'icons', component: () => import('../pages/icons.vue') },
        { path: 'cards', component: () => import('../pages/cards.vue') },
        { path: 'tables', component: () => import('../pages/tables.vue') },
        { path: 'form-layouts', component: () => import('../pages/form-layouts.vue') },
      ],
    },
    {
      path: '/',
      component: () => import('../layouts/blank.vue'),
      children: [
        { path: 'login', component: () => import('../pages/login.vue') },
        { path: 'register', component: () => import('../pages/register.vue') },
        { path: '/:pathMatch(.*)*', component: () => import('../pages/[...all].vue') },
      ],
    },
  ],
})

// 🔐 Auth guard
router.beforeEach((to, from, next) => {
  const auth = useAuthStore()

  if (to.meta.requiresAuth && !auth.token) {
    return next('/login')
  }

  // Optional: block access to login/register if already logged in
  if ((to.path === '/login' || to.path === '/register') && auth.token) {
    return next('/dashboard')
  }

  next()
})

export default router
