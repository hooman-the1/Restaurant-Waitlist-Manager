import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { NEVER, of } from 'rxjs';

import { routes } from './app.routes';
import { RESTAURANT_ACCOUNT_SERVICE, RestaurantAccountService } from './service-boundary';

describe('application routes', () => {
  let harness: RouterTestingHarness;
  let accountService: jasmine.SpyObj<RestaurantAccountService>;

  beforeEach(async () => {
    accountService = jasmine.createSpyObj('RestaurantAccountService', [
      'signup',
      'verify',
      'checkDashboardAccess'
    ]);
    accountService.signup.and.returnValue(of({ kind: 'success' }));
    accountService.verify.and.returnValue(NEVER);
    accountService.checkDashboardAccess.and.returnValue(of({ kind: 'allowed' }));
    TestBed.configureTestingModule({
      providers: [
        provideRouter(routes),
        { provide: RESTAURANT_ACCOUNT_SERVICE, useValue: accountService }
      ]
    });
    harness = await RouterTestingHarness.create();
  });

  [
    ['/dashboard', 'Restaurant Dashboard'],
    ['/restaurants/cafe-example', 'Join Waitlist'],
    ['/status/private-status-token', 'Customer Status']
  ].forEach(([url, heading]) => {
    it(`maps ${url} to its placeholder`, async () => {
      await harness.navigateByUrl(url);

      expect(harness.routeNativeElement?.querySelector('h1')?.textContent?.trim()).toBe(
        heading
      );
    });
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

  ['/', '/unknown', '/verify', '/verify/', '/restaurants', '/status'].forEach((url) => {
    it(`renders Not Found for ${url}`, async () => {
      await harness.navigateByUrl(url);

      const routeElement = harness.routeNativeElement;
      expect(routeElement?.textContent?.trim()).toBe('Not Found');
      expect(routeElement?.querySelector('h1')).toBeNull();
      expect(accountService.verify).not.toHaveBeenCalled();
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
