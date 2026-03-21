import { ApplicationConfig, provideBrowserGlobalErrorListeners, isDevMode, APP_INITIALIZER } from '@angular/core';
import { provideRouter } from '@angular/router';

import { routes } from './app.routes';
import { provideServiceWorker } from '@angular/service-worker';
import { WeightService } from './services/weight';
import { GamificationService } from './services/gamification';
import { GoogleFitService } from './services/google-fit';
import { BloodPressureService } from './services/blood-pressure';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideRouter(routes),
    provideServiceWorker('ngsw-worker.js', {
      enabled: !isDevMode(),
      registrationStrategy: 'registerWhenStable:30000',
    }),
    {
      provide: APP_INITIALIZER,
      useFactory: (weight: WeightService, gam: GamificationService, gfit: GoogleFitService, bp: BloodPressureService) => async () => {
        // Request persistent storage so the browser won't evict this origin's data
        if ('storage' in navigator && 'persist' in navigator.storage) {
          navigator.storage.persist();
        }
        // Restore from IndexedDB if localStorage was cleared
        await Promise.all([weight.restoreFromDb(), gam.restoreFromDb(), gfit.restoreFromDb(), bp.restoreFromDb()]);
      },
      deps: [WeightService, GamificationService, GoogleFitService, BloodPressureService],
      multi: true,
    },
  ],
};
