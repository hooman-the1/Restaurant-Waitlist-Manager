import { provideHttpClient } from '@angular/common/http';
import { ApplicationConfig } from '@angular/core';
import { provideRouter } from '@angular/router';

import { API_BASE_URL, LOCAL_API_BASE_URL } from './api-base-url';
import { routes } from './app.routes';
import { HttpCustomerWaitlistService } from './http-customer-waitlist.service';
import { HttpRestaurantAccountService } from './http-restaurant-account.service';
import { HttpRestaurantDashboardService } from './http-restaurant-dashboard.service';
import {
  CUSTOMER_WAITLIST_SERVICE,
  RESTAURANT_ACCOUNT_SERVICE,
  RESTAURANT_DASHBOARD_SERVICE
} from './service-boundary';

export const appConfig: ApplicationConfig = {
  providers: [
    provideRouter(routes),
    provideHttpClient(),
    { provide: API_BASE_URL, useValue: LOCAL_API_BASE_URL },
    { provide: RESTAURANT_ACCOUNT_SERVICE, useClass: HttpRestaurantAccountService },
    { provide: CUSTOMER_WAITLIST_SERVICE, useClass: HttpCustomerWaitlistService },
    { provide: RESTAURANT_DASHBOARD_SERVICE, useClass: HttpRestaurantDashboardService }
  ]
};
