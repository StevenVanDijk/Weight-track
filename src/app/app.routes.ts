import { Routes } from '@angular/router';

export const routes: Routes = [
  { path: '', redirectTo: 'dashboard', pathMatch: 'full' },
  {
    path: 'dashboard',
    loadComponent: () => import('./components/dashboard/dashboard').then(m => m.DashboardComponent),
  },
  {
    path: 'add',
    loadComponent: () => import('./components/add-entry/add-entry').then(m => m.AddEntryComponent),
  },
  {
    path: 'chart',
    loadComponent: () => import('./components/chart/chart').then(m => m.ChartComponent),
  },
  {
    path: 'history',
    loadComponent: () => import('./components/history/history').then(m => m.HistoryComponent),
  },
  {
    path: 'achievements',
    loadComponent: () => import('./components/achievements/achievements').then(m => m.AchievementsComponent),
  },
  {
    path: 'sync',
    loadComponent: () => import('./components/sync/sync').then(m => m.SyncComponent),
  },
  { path: '**', redirectTo: 'dashboard' },
];
