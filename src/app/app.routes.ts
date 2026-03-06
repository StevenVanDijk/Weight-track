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
    path: 'history',
    loadComponent: () => import('./components/history/history').then(m => m.HistoryComponent),
  },
  {
    path: 'chart',
    loadComponent: () => import('./components/chart/chart').then(m => m.ChartComponent),
  },
  { path: '**', redirectTo: 'dashboard' },
];
