import { ApplicationConfig, InjectionToken } from '@angular/core';
import { provideRouter } from '@angular/router';

import { routes } from './app.routes';
import {
  createDefaultMockApplication,
  MockApplicationComposition
} from './mock-restaurant-dashboard.service';
import {
  CUSTOMER_WAITLIST_SERVICE,
  RESTAURANT_ACCOUNT_SERVICE,
  RESTAURANT_DASHBOARD_SERVICE
} from './service-boundary';

const DEFAULT_MOCK_APPLICATION =
  new InjectionToken<MockApplicationComposition>('DefaultMockApplication');

export const appConfig: ApplicationConfig = {
  providers: [
    provideRouter(routes),
    {
      provide: DEFAULT_MOCK_APPLICATION,
      useFactory: createDefaultMockApplication
    },
    {
      provide: RESTAURANT_ACCOUNT_SERVICE,
      useFactory: (composition: MockApplicationComposition) => composition.accountService,
      deps: [DEFAULT_MOCK_APPLICATION]
    },
    {
      provide: CUSTOMER_WAITLIST_SERVICE,
      useFactory: (composition: MockApplicationComposition) =>
        composition.customerWaitlistService,
      deps: [DEFAULT_MOCK_APPLICATION]
    },
    {
      provide: RESTAURANT_DASHBOARD_SERVICE,
      useFactory: (composition: MockApplicationComposition) => composition.dashboardService,
      deps: [DEFAULT_MOCK_APPLICATION]
    }
  ]
};
