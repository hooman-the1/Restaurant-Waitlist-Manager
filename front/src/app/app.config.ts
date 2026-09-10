import { ApplicationConfig } from '@angular/core';
import { provideRouter } from '@angular/router';

import { routes } from './app.routes';
import { MockCustomerWaitlistService } from './mock-customer-waitlist.service';
import { MockRestaurantAccountService } from './mock-restaurant-account.service';
import {
  CUSTOMER_WAITLIST_SERVICE,
  RESTAURANT_ACCOUNT_SERVICE
} from './service-boundary';

export const appConfig: ApplicationConfig = {
  providers: [
    provideRouter(routes),
    {
      provide: RESTAURANT_ACCOUNT_SERVICE,
      useFactory: () => MockRestaurantAccountService.createDefault()
    },
    {
      provide: CUSTOMER_WAITLIST_SERVICE,
      useFactory: () => MockCustomerWaitlistService.createDefault()
    }
  ]
};
