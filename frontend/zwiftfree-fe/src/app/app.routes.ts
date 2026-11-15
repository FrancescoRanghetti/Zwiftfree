import { Routes } from '@angular/router';
import { authGuard, guestGuard } from './core/auth/auth.guards';
import { Shell } from './core/layout/shell';

export const routes: Routes = [
  {
    path: 'login',
    title: 'Accedi · Zwiftfree',
    canActivate: [guestGuard],
    loadComponent: () => import('./features/auth/login-page').then((m) => m.LoginPage),
  },
  {
    path: 'register',
    title: 'Registrati · Zwiftfree',
    canActivate: [guestGuard],
    loadComponent: () => import('./features/auth/register-page').then((m) => m.RegisterPage),
  },
  {
    path: '',
    component: Shell,
    canActivate: [authGuard],
    children: [
      { path: '', pathMatch: 'full', redirectTo: 'home' },
      {
        path: 'home',
        title: 'Zwiftfree',
        loadComponent: () => import('./features/home/home-page').then((m) => m.HomePage),
      },
      {
        path: 'ride',
        title: 'Pedala · Zwiftfree',
        loadComponent: () => import('./features/ride/ride-page').then((m) => m.RidePage),
      },
      {
        path: 'routes',
        title: 'Percorsi · Zwiftfree',
        loadComponent: () => import('./features/routes/routes-page').then((m) => m.RoutesPage),
      },
      {
        path: 'stats',
        title: 'Statistiche · Zwiftfree',
        loadComponent: () => import('./features/stats/stats-page').then((m) => m.StatsPage),
      },
      {
        path: 'live',
        title: 'Secondo schermo · Zwiftfree',
        loadComponent: () => import('./features/live/live-page').then((m) => m.LivePage),
      },
      {
        path: 'history',
        title: 'Storico · Zwiftfree',
        loadComponent: () => import('./features/history/history-page').then((m) => m.HistoryPage),
      },
      {
        path: 'history/:id',
        title: 'Uscita · Zwiftfree',
        loadComponent: () =>
          import('./features/history/ride-summary-page').then((m) => m.RideSummaryPage),
      },
      {
        path: 'account',
        title: 'Account · Zwiftfree',
        loadComponent: () => import('./features/account/account-page').then((m) => m.AccountPage),
      },
      {
        path: 'settings',
        title: 'Impostazioni · Zwiftfree',
        loadComponent: () =>
          import('./features/settings/settings-page').then((m) => m.SettingsPage),
      },
    ],
  },
  { path: '**', redirectTo: 'home' },
];
