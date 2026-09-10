import { Location } from '@angular/common';
import { provideLocationMocks, SpyLocation } from '@angular/common/testing';
import { TestBed } from '@angular/core/testing';
import { NavigationEnd, provideRouter, Router } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import {
  defer,
  EMPTY,
  filter,
  firstValueFrom,
  Observable,
  of,
  Subject,
  Subscriber,
  take,
  throwError
} from 'rxjs';

import { DashboardAccessResult } from './api-contracts';
import { routes } from './app.routes';
import {
  RESTAURANT_ACCOUNT_SERVICE,
  RestaurantAccountService
} from './service-boundary';

describe('restaurant dashboard access route guard', () => {
  let accountService: jasmine.SpyObj<RestaurantAccountService>;
  let harness: RouterTestingHarness;
  let router: Router;

  beforeEach(async () => {
    accountService = jasmine.createSpyObj('RestaurantAccountService', [
      'signup',
      'verify',
      'checkDashboardAccess'
    ]);
    accountService.checkDashboardAccess.and.returnValue(of({ kind: 'allowed' }));

    TestBed.configureTestingModule({
      providers: [
        provideRouter(routes),
        provideLocationMocks(),
        { provide: RESTAURANT_ACCOUNT_SERVICE, useValue: accountService }
      ]
    });
    harness = await RouterTestingHarness.create();
    router = TestBed.inject(Router);
  });

  it('calls the account service once and subscribes once for one dashboard navigation', async () => {
    let subscriptions = 0;
    accountService.checkDashboardAccess.and.returnValue(
      defer(() => {
        subscriptions += 1;
        return of({ kind: 'allowed' } as const);
      })
    );

    await harness.navigateByUrl('/dashboard');

    expect(accountService.checkDashboardAccess).toHaveBeenCalledTimes(1);
    expect(subscriptions).toBe(1);
  });

  it('does not activate or render the dashboard while the access check is pending', async () => {
    const access = new Subject<DashboardAccessResult>();
    accountService.checkDashboardAccess.and.returnValue(access);

    const navigation = harness.navigateByUrl('/dashboard');
    await Promise.resolve();

    expect(accountService.checkDashboardAccess).toHaveBeenCalledTimes(1);
    expect(router.url).not.toBe('/dashboard');
    expect(harness.routeNativeElement?.textContent).not.toContain('Restaurant Dashboard');

    access.next({ kind: 'allowed' });
    access.complete();
    await navigation;
  });

  it('activates the dashboard and preserves its URL only for an allowed result', async () => {
    await harness.navigateByUrl('/dashboard');

    expect(router.url).toBe('/dashboard');
    expect(harness.routeNativeElement?.textContent?.trim()).toBe('Restaurant Dashboard');
  });

  [
    {
      name: 'an unauthorized result',
      result: { kind: 'unauthorized' } as DashboardAccessResult
    },
    {
      name: 'an unexpected result',
      result: {
        kind: 'unexpected',
        message: 'Something went wrong. Please try again.'
      } as DashboardAccessResult
    }
  ].forEach(({ name, result }) => {
    it(`redirects ${name} to the exact generic root fallback`, async () => {
      accountService.checkDashboardAccess.and.returnValue(of(result));

      await harness.navigateByUrl('/dashboard');

      expect(router.url).toBe('/');
      expect(harness.routeNativeElement?.textContent?.trim()).toBe('Not Found');
      expect(harness.routeNativeElement?.textContent).not.toContain(
        'Something went wrong. Please try again.'
      );
      expect(harness.routeNativeElement?.textContent).not.toContain(
        'Restaurant Dashboard'
      );
    });
  });

  it('hides an observable error and redirects to the exact generic root fallback', async () => {
    accountService.checkDashboardAccess.and.returnValue(
      throwError(() => new Error('private transport detail'))
    );

    await harness.navigateByUrl('/dashboard');

    expect(router.url).toBe('/');
    expect(harness.routeNativeElement?.textContent?.trim()).toBe('Not Found');
    expect(harness.routeNativeElement?.textContent).not.toContain(
      'private transport detail'
    );
  });

  it('redirects an empty completion to the exact generic root fallback', async () => {
    accountService.checkDashboardAccess.and.returnValue(EMPTY);

    await harness.navigateByUrl('/dashboard');

    expect(router.url).toBe('/');
    expect(harness.routeNativeElement?.textContent?.trim()).toBe('Not Found');
  });

  it('performs a fresh check for a later dashboard navigation attempt', async () => {
    accountService.checkDashboardAccess.and.returnValues(
      of({ kind: 'unauthorized' }),
      of({ kind: 'allowed' })
    );

    await harness.navigateByUrl('/dashboard');
    expect(router.url).toBe('/');

    await harness.navigateByUrl('/dashboard');

    expect(accountService.checkDashboardAccess).toHaveBeenCalledTimes(2);
    expect(router.url).toBe('/dashboard');
    expect(harness.routeNativeElement?.textContent?.trim()).toBe('Restaurant Dashboard');
  });

  it('performs a fresh check when browser history returns to the dashboard', async () => {
    const location = TestBed.inject(Location) as SpyLocation;
    router.setUpLocationChangeListener();
    await harness.navigateByUrl('/signup');
    await harness.navigateByUrl('/dashboard');
    await harness.navigateByUrl('/restaurants/cafe-example');

    const backToDashboard = nextNavigationEnd();
    location.simulateUrlPop('/dashboard');
    await backToDashboard;

    expect(router.url).toBe('/dashboard');
    expect(accountService.checkDashboardAccess).toHaveBeenCalledTimes(2);
  });

  it('checks access after the existing successful-verification redirect', async () => {
    accountService.verify.and.returnValue(of({ kind: 'success' }));
    const dashboardNavigation = firstValueFrom(
      router.events.pipe(
        filter(
          (event): event is NavigationEnd =>
            event instanceof NavigationEnd && event.urlAfterRedirects === '/dashboard'
        ),
        take(1)
      )
    );

    await harness.navigateByUrl('/verify/exact-token');
    await dashboardNavigation;

    expect(accountService.verify).toHaveBeenCalledOnceWith({ token: 'exact-token' });
    expect(accountService.checkDashboardAccess).toHaveBeenCalledTimes(1);
    expect(router.url).toBe('/dashboard');
    expect(harness.routeNativeElement?.textContent?.trim()).toBe('Restaurant Dashboard');
  });

  it('cancels a superseded check and isolates its late result and error', async () => {
    let accessSubscriber: Subscriber<DashboardAccessResult> | undefined;
    let cancellations = 0;
    accountService.checkDashboardAccess.and.returnValue(
      new Observable((subscriber) => {
        accessSubscriber = subscriber;
        return () => {
          cancellations += 1;
        };
      })
    );

    const dashboardNavigation = router.navigateByUrl('/dashboard');
    await Promise.resolve();
    await harness.navigateByUrl('/signup');

    expect(await dashboardNavigation).toBeFalse();
    expect(cancellations).toBe(1);
    expect(accessSubscriber?.closed).toBeTrue();

    accessSubscriber?.next({ kind: 'allowed' });
    accessSubscriber?.error(new Error('late private transport detail'));
    await Promise.resolve();

    expect(router.url).toBe('/signup');
    expect(harness.routeNativeElement?.querySelector('h1')?.textContent?.trim()).toBe(
      'Create restaurant account'
    );
    expect(harness.routeNativeElement?.textContent).not.toContain(
      'Restaurant Dashboard'
    );
    expect(harness.routeNativeElement?.textContent).not.toContain(
      'late private transport detail'
    );
  });

  function nextNavigationEnd(): Promise<NavigationEnd> {
    return firstValueFrom(
      router.events.pipe(
        filter((event): event is NavigationEnd => event instanceof NavigationEnd),
        take(1)
      )
    );
  }
});
