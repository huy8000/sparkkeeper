import { createRouter, createWebHistory, type Router } from 'vue-router';

import AdminLayout from '../layouts/AdminLayout.vue';
import AccountDetailPage from '../pages/AccountDetailPage.vue';
import AccountsPage from '../pages/AccountsPage.vue';
import DashboardPage from '../pages/DashboardPage.vue';
import NotFoundPage from '../pages/NotFoundPage.vue';
import RunDetailPage from '../pages/RunDetailPage.vue';
import RunsPage from '../pages/RunsPage.vue';
import SchedulesPage from '../pages/SchedulesPage.vue';
import TemplatesPage from '../pages/TemplatesPage.vue';

export function createAdminRouter(): Router {
  return createRouter({
    history: createWebHistory(),
    routes: [
      {
        path: '/',
        component: AdminLayout,
        children: [
          { path: '', component: DashboardPage, meta: { title: 'Dashboard' } },
          { path: 'accounts', component: AccountsPage, meta: { title: 'Accounts' } },
          {
            path: 'accounts/:accountId',
            component: AccountDetailPage,
            meta: { title: 'Account detail' },
          },
          { path: 'schedules', component: SchedulesPage, meta: { title: 'Schedules' } },
          { path: 'templates', component: TemplatesPage, meta: { title: 'Templates' } },
          { path: 'runs', component: RunsPage, meta: { title: 'Runs' } },
          { path: 'runs/:runId', component: RunDetailPage, meta: { title: 'Run detail' } },
          { path: ':pathMatch(.*)*', component: NotFoundPage, meta: { title: 'Not found' } },
        ],
      },
    ],
    scrollBehavior: () => ({ top: 0 }),
  });
}

export const router = createAdminRouter();
