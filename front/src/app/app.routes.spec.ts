import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { NEVER, of } from 'rxjs';

import { DashboardLoadResult } from './api-contracts';
import { routes } from './app.routes';
import {
  CUSTOMER_WAITLIST_SERVICE,
  RESTAURANT_ACCOUNT_SERVICE,
  RESTAURANT_DASHBOARD_SERVICE,
  CustomerWaitlistService,
  RestaurantAccountService,
  RestaurantDashboardService
} from './service-boundary';

describe('application routes', () => {
  let harness: RouterTestingHarness;
  let accountService: jasmine.SpyObj<RestaurantAccountService>;
  let dashboardService: jasmine.SpyObj<RestaurantDashboardService>;
  let customerWaitlistService: jasmine.SpyObj<CustomerWaitlistService>;

  beforeEach(async () => {
    accountService = jasmine.createSpyObj('RestaurantAccountService', [
      'signup',
      'verify',
      'checkDashboardAccess'
    ]);
    accountService.signup.and.returnValue(of({ kind: 'success' }));
    accountService.verify.and.returnValue(NEVER);
    accountService.checkDashboardAccess.and.returnValue(of({ kind: 'allowed' }));
    dashboardService = jasmine.createSpyObj('RestaurantDashboardService', [
      'loadDashboard',
      'resolveEntry'
    ]);
    dashboardService.loadDashboard.and.returnValue(of({
      kind: 'success',
      dashboard: {
        restaurantName: 'Route Test Restaurant',
        activeEntries: [],
        resolvedToday: []
      }
    }));
    customerWaitlistService = jasmine.createSpyObj('CustomerWaitlistService', [
      'lookupPublicRestaurant',
      'joinWaitlist',
      'loadPrivateStatus',
      'cancelEntry'
    ]);
    customerWaitlistService.lookupPublicRestaurant.and.returnValue(of({
      kind: 'success',
      restaurant: { restaurantName: 'Route Test Restaurant' }
    }));
    customerWaitlistService.loadPrivateStatus.and.returnValue(NEVER);
    TestBed.configureTestingModule({
      providers: [
        provideRouter(routes),
        { provide: RESTAURANT_ACCOUNT_SERVICE, useValue: accountService },
        { provide: RESTAURANT_DASHBOARD_SERVICE, useValue: dashboardService },
        { provide: CUSTOMER_WAITLIST_SERVICE, useValue: customerWaitlistService }
      ]
    });
    harness = await RouterTestingHarness.create();
  });

  it('maps the public restaurant route to its join form', async () => {
    await harness.navigateByUrl('/restaurants/cafe-example');

    expect(harness.routeNativeElement?.querySelector('h1')?.textContent?.trim()).toBe(
      'Route Test Restaurant'
    );
    expect(harness.routeNativeElement?.querySelector('form')).not.toBeNull();
    expect(customerWaitlistService.lookupPublicRestaurant).toHaveBeenCalledOnceWith({
      restaurantSlug: 'cafe-example'
    });
  });

  it('maps the exact decoded customer token to the private status page once', async () => {
    await harness.navigateByUrl('/status/Opaque%20Token%2BCase');
    harness.detectChanges();

    expect(harness.routeNativeElement?.textContent?.trim()).toBe('Loading…');
    expect(customerWaitlistService.loadPrivateStatus).toHaveBeenCalledOnceWith({
      privateToken: 'Opaque Token+Case'
    });
  });

  it('maps the guarded dashboard route to the queue view', async () => {
    await harness.navigateByUrl('/dashboard');
    harness.detectChanges();

    expect(harness.routeNativeElement?.querySelector('h1')?.textContent?.trim()).toBe(
      'Route Test Restaurant'
    );
    expect(dashboardService.loadDashboard).toHaveBeenCalledTimes(1);
  });

  it('renders the existing root Not Found fallback when dashboard authorization is lost after activation', async () => {
    dashboardService.loadDashboard.and.returnValue(of({
      kind: 'unauthorized'
    } as DashboardLoadResult));

    await harness.navigateByUrl('/dashboard');
    await harness.fixture.whenStable();
    harness.detectChanges();

    expect(TestBed.inject(Router).url).toBe('/');
    expect(harness.routeNativeElement?.textContent?.trim()).toBe('Not Found');
  });

  it('passes Angular\'s exact decoded callback token to verification once', async () => {
    await harness.navigateByUrl('/verify/Opaque%20Token%2BCase');
    harness.detectChanges();

    expect(accountService.verify).toHaveBeenCalledOnceWith({
      token: 'Opaque Token+Case'
    });
    expect(harness.routeNativeElement?.textContent?.trim()).toBe('Verifying…');
  });

  it('maps /signup to the restaurant signup form', async () => {
    await harness.navigateByUrl('/signup');

    expect(harness.routeNativeElement?.querySelector('h1')?.textContent?.trim()).toBe(
      'Create restaurant account'
    );
    expect(harness.routeNativeElement?.querySelector('form')).not.toBeNull();
  });

  ['/', '/unknown', '/verify', '/verify/', '/restaurants', '/status', '/status/'].forEach((url) => {
    it(`renders Not Found for ${url}`, async () => {
      await harness.navigateByUrl(url);

      const routeElement = harness.routeNativeElement;
      expect(routeElement?.textContent?.trim()).toBe('Not Found');
      expect(routeElement?.querySelector('h1')).toBeNull();
      expect(accountService.verify).not.toHaveBeenCalled();
      expect(customerWaitlistService.loadPrivateStatus).not.toHaveBeenCalled();
    });
  });

  it('keeps parameter values available to later feature components', async () => {
    await harness.navigateByUrl('/verify/any-token');
    const router = TestBed.inject(Router);

    expect(router.routerState.snapshot.root.firstChild?.paramMap.get('token')).toBe(
      'any-token'
    );
  });
});
