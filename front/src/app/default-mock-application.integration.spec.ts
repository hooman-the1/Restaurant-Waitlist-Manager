import { TestBed } from '@angular/core/testing';
import { NavigationEnd, Router } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { filter, firstValueFrom, take } from 'rxjs';

import { appConfig } from './app.config';
import { ActiveEntryActionReference } from './api-contracts';
import { PublicWaitlistJoinComponent } from './public-waitlist-join.component';
import {
  CUSTOMER_WAITLIST_SERVICE,
  RESTAURANT_ACCOUNT_SERVICE,
  RESTAURANT_DASHBOARD_SERVICE,
  CustomerWaitlistService,
  RestaurantDashboardService
} from './service-boundary';

describe('default mock application demo', () => {
  const activeToken = '8f4d6e2b-1a73-4c95-b0e8-62d9f71a3c44';
  const resolvedToken = 'c2a7198e-6d40-4b53-9f81-37e5a6c04bd2';

  let harness: RouterTestingHarness;

  beforeEach(async () => {
    TestBed.configureTestingModule({ providers: appConfig.providers });
    harness = await RouterTestingHarness.create();
  });

  it('registers the three application boundaries without cross-wiring and shares their state', async () => {
    const account = TestBed.inject(RESTAURANT_ACCOUNT_SERVICE);
    const customer = TestBed.inject(CUSTOMER_WAITLIST_SERVICE);
    const dashboard = TestBed.inject(RESTAURANT_DASHBOARD_SERVICE);

    expect(await firstValueFrom(account.checkDashboardAccess())).toEqual({ kind: 'allowed' });
    expect(await firstValueFrom(customer.lookupPublicRestaurant({
      restaurantSlug: 'demo-restaurant'
    }))).toEqual({
      kind: 'success', restaurant: { restaurantName: 'Demo Restaurant' }
    });

    const before = await firstValueFrom(dashboard.loadDashboard());
    expect(before.kind).toBe('success');
    if (before.kind !== 'success') return;
    expect(before.dashboard.activeEntries.map((entry) => entry.customerName))
      .toEqual(['Morgan Lee', 'Sam Rivera']);
    const actionReferences = before.dashboard.activeEntries.map((entry) => entry.actionReference);
    actionReferences.forEach((reference) => {
      expect(reference).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
      expect(reference).not.toBe(activeToken as ActiveEntryActionReference);
      expect(reference).not.toBe(resolvedToken as ActiveEntryActionReference);
    });

    expect(await firstValueFrom(customer.cancelEntry({ privateToken: activeToken })))
      .toEqual({ kind: 'cancelled' });
    const after = await firstValueFrom(dashboard.loadDashboard());
    expect(after.kind === 'success' && after.dashboard.activeEntries.map(
      (entry) => entry.customerName
    )).toEqual(['Sam Rivera']);
  });

  it('renders the public demo route and redirects a valid join to its random private route', async () => {
    await harness.navigateByUrl('/restaurants/demo-restaurant');
    await harness.fixture.whenStable();
    harness.detectChanges();

    const route = harness.routeNativeElement as HTMLElement;
    expect(route.querySelector('h1')?.textContent?.trim()).toBe('Demo Restaurant');
    expect(route.querySelectorAll('input').length).toBe(3);

    const component = harness.routeDebugElement?.componentInstance as PublicWaitlistJoinComponent;
    component.customerName = 'Taylor Reed';
    component.phone = '555-010-4000';
    component.partySize = 3;
    const router = TestBed.inject(Router);
    const navigation = firstValueFrom(router.events.pipe(
      filter((event): event is NavigationEnd => event instanceof NavigationEnd),
      take(1)
    ));
    component.submit();
    await navigation;
    harness.detectChanges();

    const privatePath = router.url;
    expect(privatePath).toMatch(/^\/status\/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
    expect(privatePath).not.toBe(`/status/${activeToken}`);
    expect(privatePath).not.toBe(`/status/${resolvedToken}`);
    await firstValueFrom(TestBed.inject(CUSTOMER_WAITLIST_SERVICE).loadPrivateStatus({
      privateToken: privatePath.slice('/status/'.length)
    }));
    harness.detectChanges();
    expect(harness.routeNativeElement?.querySelector('[data-position]')?.textContent?.trim())
      .toBe('#3');
  });

  it('renders the exact active demo status with its cancellation control', async () => {
    await harness.navigateByUrl(`/status/${activeToken}`);
    harness.detectChanges();

    const route = harness.routeNativeElement as HTMLElement;
    expect(route.querySelector('h1')?.textContent?.trim()).toBe('Demo Restaurant');
    expect(route.querySelector('[data-position]')?.textContent?.trim()).toBe('#1');
    expect(route.querySelector('button')?.textContent?.trim()).toBe('Cancel');
  });

  it('renders the exact resolved demo status without active-only content', async () => {
    await harness.navigateByUrl(`/status/${resolvedToken}`);
    await harness.fixture.whenStable();
    harness.detectChanges();

    const route = harness.routeNativeElement as HTMLElement;
    expect(route.querySelector('h1')?.textContent?.trim()).toBe('Demo Restaurant');
    expect(route.querySelector('[data-final-status]')?.textContent?.trim()).toBe('Seated');
    expect(route.querySelector('[data-position], button')).toBeNull();
  });

  it('admits and renders the complete seeded dashboard route', async () => {
    await harness.navigateByUrl('/dashboard');
    await harness.fixture.whenStable();
    harness.detectChanges();

    const route = harness.routeNativeElement as HTMLElement;
    expect(TestBed.inject(Router).url).toBe('/dashboard');
    expect(route.querySelector('h1')?.textContent?.trim()).toBe('Demo Restaurant');
    expect(sectionRows(route, 'active')).toEqual([
      ['#1', 'Morgan Lee', '(555) 010-1000', '6'],
      ['#2', 'Sam Rivera', '555-010-2000', '2']
    ]);
    expect(sectionRows(route, 'resolved')).toEqual([
      ['Alex Chen', '4', 'Seated']
    ]);
    expect(route.textContent).not.toContain('Not Found');
  });

  it('creates the documented state again after an earlier default composition is mutated', async () => {
    const customer = TestBed.inject(CUSTOMER_WAITLIST_SERVICE);
    const dashboard = TestBed.inject(RESTAURANT_DASHBOARD_SERVICE);
    const initial = await firstValueFrom(dashboard.loadDashboard());
    expect(initial.kind).toBe('success');
    if (initial.kind !== 'success') return;
    const samReference = initial.dashboard.activeEntries[1].actionReference;

    await firstValueFrom(customer.cancelEntry({ privateToken: activeToken }));
    await firstValueFrom(dashboard.resolveEntry({
      actionReference: samReference as ActiveEntryActionReference,
      resolution: 'no-show'
    }));

    TestBed.resetTestingModule();
    TestBed.configureTestingModule({ providers: appConfig.providers });
    const freshCustomer = TestBed.inject(CUSTOMER_WAITLIST_SERVICE);
    const freshDashboard = TestBed.inject(RESTAURANT_DASHBOARD_SERVICE);

    expect(await firstValueFrom(freshCustomer.loadPrivateStatus({ privateToken: activeToken })))
      .toEqual({ kind: 'active', restaurantName: 'Demo Restaurant', position: 1 });
    expect(await firstValueFrom(freshCustomer.loadPrivateStatus({ privateToken: resolvedToken })))
      .toEqual({ kind: 'resolved', restaurantName: 'Demo Restaurant', finalStatus: 'seated' });
    const freshView = await firstValueFrom(freshDashboard.loadDashboard());
    expect(freshView.kind === 'success' && freshView.dashboard.activeEntries.map(
      ({ position, customerName }) => ({ position, customerName })
    )).toEqual([
      { position: 1, customerName: 'Morgan Lee' },
      { position: 2, customerName: 'Sam Rivera' }
    ]);
  });

  function sectionRows(root: HTMLElement, section: string): string[][] {
    return Array.from(root.querySelectorAll<HTMLElement>(`[data-section="${section}"] li`))
      .map((row) => Array.from(row.querySelectorAll<HTMLElement>('span[data-label]'))
        .map((value) => value.textContent?.trim() ?? ''));
  }
});
