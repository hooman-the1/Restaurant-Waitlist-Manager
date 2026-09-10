import { ApplicationConfig } from '@angular/core';
import { provideRouter } from '@angular/router';

import { routes } from './app.routes';
import { MockRestaurantAccountService } from './mock-restaurant-account.service';
import { RESTAURANT_ACCOUNT_SERVICE } from './service-boundary';

export const appConfig: ApplicationConfig = {
  providers: [
    provideRouter(routes),
    {
      provide: RESTAURANT_ACCOUNT_SERVICE,
      useFactory: () => MockRestaurantAccountService.createDefault()
    }
  ]
};
