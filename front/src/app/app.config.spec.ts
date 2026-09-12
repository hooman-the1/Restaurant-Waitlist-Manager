import { HttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { firstValueFrom } from 'rxjs';

import { appConfig } from './app.config';
import { LOCAL_API_BASE_URL } from './api-base-url';
import { HttpCustomerWaitlistService } from './http-customer-waitlist.service';
import { HttpRestaurantAccountService } from './http-restaurant-account.service';
import { HttpRestaurantDashboardService } from './http-restaurant-dashboard.service';
import {
  CUSTOMER_WAITLIST_SERVICE,
  RESTAURANT_ACCOUNT_SERVICE,
  RESTAURANT_DASHBOARD_SERVICE
} from './service-boundary';

describe('production application composition', () => {
  it('provides the three singleton HTTP adapters and shares customer lookup state', async () => {
    TestBed.configureTestingModule({
      providers: [...appConfig.providers, provideHttpClientTesting()]
    });
    const http = TestBed.inject(HttpTestingController);
    const account = TestBed.inject(RESTAURANT_ACCOUNT_SERVICE);
    const customer = TestBed.inject(CUSTOMER_WAITLIST_SERVICE);
    const dashboard = TestBed.inject(RESTAURANT_DASHBOARD_SERVICE);

    expect(TestBed.inject(HttpClient)).toBeTruthy();
    expect(account instanceof HttpRestaurantAccountService).toBeTrue();
    expect(customer instanceof HttpCustomerWaitlistService).toBeTrue();
    expect(dashboard instanceof HttpRestaurantDashboardService).toBeTrue();
    expect(TestBed.inject(CUSTOMER_WAITLIST_SERVICE)).toBe(customer);

    const lookup = firstValueFrom(customer.lookupPublicRestaurant({
      restaurantSlug: 'demo-restaurant'
    }));
    http.expectOne(`${LOCAL_API_BASE_URL}/api/restaurants/demo-restaurant`).flush({
      kind: 'success', restaurant: { restaurantName: 'Demo Restaurant' }
    }, { status: 200, statusText: 'OK' });
    await lookup;

    const join = firstValueFrom(customer.joinWaitlist({
      customerName: 'Guest', phone: '5551234', partySize: 2
    }));
    http.expectOne(`${LOCAL_API_BASE_URL}/api/restaurants/demo-restaurant/waitlist-entries`).flush({
      kind: 'success', privateStatusToken: 'private-token'
    }, { status: 201, statusText: 'Created' });
    await join;
    http.verify();
  });
});
