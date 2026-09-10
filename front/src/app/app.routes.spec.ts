import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { of } from 'rxjs';

import { routes } from './app.routes';
import { RESTAURANT_ACCOUNT_SERVICE, RestaurantAccountService } from './service-boundary';

describe('application routes', () => {
  let harness: RouterTestingHarness;

  beforeEach(async () => {
    const accountService: Pick<RestaurantAccountService, 'signup'> = {
      signup: () => of({ kind: 'success' })
    };
    TestBed.configureTestingModule({
      providers: [
        provideRouter(routes),
        { provide: RESTAURANT_ACCOUNT_SERVICE, useValue: accountService }
      ]
    });
    harness = await RouterTestingHarness.create();
  });

  [
    ['/verify/verification-token', 'Verify Email'],
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

  it('maps /signup to the restaurant signup form', async () => {
    await harness.navigateByUrl('/signup');

    expect(harness.routeNativeElement?.querySelector('h1')?.textContent?.trim()).toBe(
      'Create restaurant account'
    );
    expect(harness.routeNativeElement?.querySelector('form')).not.toBeNull();
  });

  ['/', '/unknown', '/verify', '/restaurants', '/status'].forEach((url) => {
    it(`renders Not Found for ${url}`, async () => {
      await harness.navigateByUrl(url);

      const routeElement = harness.routeNativeElement;
      expect(routeElement?.textContent?.trim()).toBe('Not Found');
      expect(routeElement?.querySelector('h1')).toBeNull();
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
