import { APP_INITIALIZER, ApplicationConfig, provideZoneChangeDetection } from '@angular/core';
import { provideRouter } from '@angular/router';

import { routes } from './app.routes';
import { provideAnimationsAsync } from '@angular/platform-browser/animations/async';
import { ElectronIpcService } from './services/electron-ipc-service';
import { InternalEventsBusService } from './services/internal-events-bus-service';
import { ConfigurationProviderService } from './services/configuration-provider-service';
export const appConfig: ApplicationConfig = {
  providers: [
    provideZoneChangeDetection({ eventCoalescing: true }),
    provideRouter(routes),
    provideAnimationsAsync(),
    ElectronIpcService,
    InternalEventsBusService,
    {
      provide: APP_INITIALIZER,
      multi: true,
      deps: [ConfigurationProviderService],
      useFactory: (config: ConfigurationProviderService) => () => config.load()
    }
  ]
};
