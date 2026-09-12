import { fakeAsync, flushMicrotasks, TestBed } from '@angular/core/testing';
import { defer, firstValueFrom, Observable, of, throwError } from 'rxjs';

import {
  ActiveEntryActionReference,
  DashboardAccessResult,
  DUPLICATE_PHONE_MESSAGE,
  StaffResolution,
  UNEXPECTED_ERROR_MESSAGE
} from './api-contracts';
import {
  createDefaultMockApplication,
  createMockApplicationForTesting,
  MockRestaurantDashboardService
} from './mock-restaurant-dashboard.service';
import {
  CUSTOMER_WAITLIST_SERVICE,
  RESTAURANT_ACCOUNT_SERVICE,
  RESTAURANT_DASHBOARD_SERVICE,
  RestaurantAccountService,
  RestaurantDashboardService
} from './service-boundary';

describe('MockRestaurantDashboardService', () => {
  const restaurants = [
    { slug: 'first', restaurantName: 'First Restaurant' },
    { slug: 'second', restaurantName: 'Second Restaurant' }
  ] as const;

  const entries = [
    {
      restaurantSlug: 'first', customerName: 'Large First', phone: '(555) 111-1111',
      partySize: 8, status: 'active' as const, privateStatusToken: 'private-first',
      actionReference: 'action-first'
    },
    {
      restaurantSlug: 'second', customerName: 'Foreign', phone: '555-9999',
      partySize: 1, status: 'active' as const, privateStatusToken: 'private-foreign',
      actionReference: 'action-foreign'
    },
    {
      restaurantSlug: 'first', customerName: 'Small Later', phone: '555-2222',
      partySize: 1, status: 'active' as const, privateStatusToken: 'private-later',
      actionReference: 'action-later'
    },
    {
      restaurantSlug: 'first', customerName: 'Already Done', phone: '555-3333',
      partySize: 3, status: 'cancelled' as const, privateStatusToken: 'private-done',
      actionReference: 'action-done'
    }
  ] as const;

  const composition = (
    overrides: Parameters<typeof createMockApplicationForTesting>[0] = {}
  ) => createMockApplicationForTesting({
    restaurants,
    entries,
    authorizedRestaurantSlug: 'first',
    privateTokenGenerator: jasmine.createSpy().and.returnValues('new-private', 'newer-private'),
    actionReferenceGenerator: jasmine.createSpy().and.returnValues('new-action', 'newer-action'),
    ...overrides
  });

  const load = (service: RestaurantDashboardService) =>
    firstValueFrom(service.loadDashboard());

  const resolve = (
    service: RestaurantDashboardService,
    actionReference: string,
    resolution: StaffResolution
  ) => firstValueFrom(service.resolveEntry({
    actionReference: actionReference as ActiveEntryActionReference,
    resolution
  }));

  it('registers one dashboard mock and shares the default composition through DI', async () => {
    const concrete = createDefaultMockApplication();
    TestBed.configureTestingModule({ providers: [
      { provide: RESTAURANT_ACCOUNT_SERVICE, useValue: concrete.accountService },
      { provide: CUSTOMER_WAITLIST_SERVICE, useValue: concrete.customerWaitlistService },
      { provide: RESTAURANT_DASHBOARD_SERVICE, useValue: concrete.dashboardService }
    ] });

    const account = TestBed.inject(RESTAURANT_ACCOUNT_SERVICE);
    const customer = TestBed.inject(CUSTOMER_WAITLIST_SERVICE);
    const dashboard = TestBed.inject(RESTAURANT_DASHBOARD_SERVICE);

    expect(dashboard instanceof MockRestaurantDashboardService).toBeTrue();
    expect(await firstValueFrom(account.checkDashboardAccess())).toEqual({ kind: 'allowed' });
    const result = await load(dashboard);
    expect(result.kind).toBe('success');
    if (result.kind !== 'success') return;
    expect(result.dashboard.restaurantName).toBe('Demo Restaurant');
    expect(result.dashboard.activeEntries.length).toBeGreaterThanOrEqual(2);
    expect(result.dashboard.activeEntries[0].partySize)
      .toBeGreaterThan(result.dashboard.activeEntries[1].partySize);
    expect(result.dashboard.resolvedToday.length).toBeGreaterThanOrEqual(1);
    const actionReferences = result.dashboard.activeEntries.map(
      (entry) => entry.actionReference
    );
    expect(new Set(actionReferences).size).toBe(actionReferences.length);
    actionReferences.forEach((actionReference) => {
      expect(actionReference).toMatch(/^[0-9a-f-]{36}$/i);
      expect(actionReference).not.toContain('demo-restaurant');
      expect(actionReference).not.toContain('555');
    });

    await firstValueFrom(customer.lookupPublicRestaurant({ restaurantSlug: 'demo-restaurant' }));
    await firstValueFrom(customer.joinWaitlist({
      customerName: 'Visible Join', phone: '555-8080', partySize: 2
    }));
    const afterJoin = await load(dashboard);
    expect(afterJoin.kind === 'success' &&
      afterJoin.dashboard.activeEntries.some((entry) => entry.customerName === 'Visible Join'))
      .toBeTrue();
  });

  it('returns exact privacy-minimal detached dashboard shapes in restaurant FIFO order', async () => {
    const { dashboardService } = composition();

    const result = await load(dashboardService);

    expect(Object.keys(result)).toEqual(['kind', 'dashboard']);
    if (result.kind !== 'success') return;
    expect(Object.keys(result.dashboard)).toEqual([
      'restaurantName', 'activeEntries', 'resolvedToday'
    ]);
    expect(result.dashboard.restaurantName).toBe('First Restaurant');
    expect(result.dashboard.activeEntries).toEqual([
      {
        position: 1, customerName: 'Large First', phone: '(555) 111-1111',
        partySize: 8, actionReference: 'action-first' as ActiveEntryActionReference
      },
      {
        position: 2, customerName: 'Small Later', phone: '555-2222',
        partySize: 1, actionReference: 'action-later' as ActiveEntryActionReference
      }
    ]);
    expect(result.dashboard.resolvedToday).toEqual([
      { customerName: 'Already Done', partySize: 3, finalStatus: 'cancelled' }
    ]);
    expect(Object.keys(result.dashboard.activeEntries[0])).toEqual([
      'position', 'customerName', 'phone', 'partySize', 'actionReference'
    ]);
    expect(Object.keys(result.dashboard.resolvedToday[0])).toEqual([
      'customerName', 'partySize', 'finalStatus'
    ]);
    expect(JSON.stringify(result)).not.toContain('private-');
    expect(JSON.stringify(result)).not.toContain('5551111111');
    expect(JSON.stringify(result)).not.toContain('second');

    (result.dashboard.activeEntries as unknown as { customerName: string }[])[0].customerName = 'tampered';
    const second = await load(dashboardService);
    expect(second.kind === 'success' && second.dashboard.activeEntries[0].customerName)
      .toBe('Large First');
  });

  ['none', 'unverified', 'missing'].forEach((initialSession) => {
    it(`denies reads and writes for a ${initialSession} account session`, async () => {
      const { dashboardService, customerWaitlistService } = composition({
        initialSession: initialSession as 'none' | 'unverified' | 'missing'
      });

      expect(await load(dashboardService)).toEqual({ kind: 'unauthorized' });
      expect(await resolve(dashboardService, 'action-first', 'seated'))
        .toEqual({ kind: 'unauthorized' });
      expect(await firstValueFrom(customerWaitlistService.loadPrivateStatus({
        privateToken: 'private-first'
      }))).toEqual({
        kind: 'active', restaurantName: 'First Restaurant', position: 1
      });
    });
  });

  it('authorizes before validating a reference or runtime resolution', async () => {
    const { dashboardService } = composition({ initialSession: 'none' });

    expect(await firstValueFrom(dashboardService.resolveEntry({
      actionReference: 'unknown' as ActiveEntryActionReference,
      resolution: 'waiting' as StaffResolution
    }))).toEqual({ kind: 'unauthorized' });
  });

  it('supports either dashboard section being empty without adding UI messages', async () => {
    const activeOnly = composition({ entries: [entries[0]] });
    const resolvedOnly = composition({ entries: [entries[3]] });

    const first = await load(activeOnly.dashboardService);
    const second = await load(resolvedOnly.dashboardService);
    expect(first.kind === 'success' && first.dashboard.resolvedToday).toEqual([]);
    expect(second.kind === 'success' && second.dashboard.activeEntries).toEqual([]);
    expect(JSON.stringify([first, second])).not.toContain('No customers waiting');
    expect(JSON.stringify([first, second])).not.toContain('No resolved entries today');
  });

  (['seated', 'cancelled', 'no-show'] as const).forEach((finalStatus) => {
    it(`atomically resolves an active entry as ${finalStatus} for every boundary`, async () => {
      const { dashboardService, customerWaitlistService } = composition();

      expect(await resolve(dashboardService, 'action-first', finalStatus))
        .toEqual({ kind: 'success' });
      const after = await load(dashboardService);
      expect(after.kind).toBe('success');
      if (after.kind !== 'success') return;
      expect(after.dashboard.activeEntries).toEqual([
        {
          position: 1, customerName: 'Small Later', phone: '555-2222', partySize: 1,
          actionReference: 'action-later' as ActiveEntryActionReference
        }
      ]);
      expect(after.dashboard.resolvedToday).toContain(jasmine.objectContaining({
        customerName: 'Large First', partySize: 8, finalStatus
      }));
      expect(await firstValueFrom(customerWaitlistService.loadPrivateStatus({
        privateToken: 'private-first'
      }))).toEqual({
        kind: 'resolved', restaurantName: 'First Restaurant', finalStatus
      });
      expect(await firstValueFrom(customerWaitlistService.loadPrivateStatus({
        privateToken: 'private-later'
      }))).toEqual({
        kind: 'active', restaurantName: 'First Restaurant', position: 1
      });
      expect(await resolve(dashboardService, 'action-first', finalStatus))
        .toEqual({ kind: 'not-found' });
    });
  });

  it('keeps remaining action references stable after positions change', async () => {
    const { dashboardService } = composition();

    await resolve(dashboardService, 'action-first', 'seated');
    expect(await resolve(dashboardService, 'action-later', 'no-show'))
      .toEqual({ kind: 'success' });
    const result = await load(dashboardService);
    expect(result.kind === 'success' && result.dashboard.activeEntries).toEqual([]);
  });

  it('observes customer cancellation through the same dashboard collection', async () => {
    const { dashboardService, customerWaitlistService } = composition();

    expect(await firstValueFrom(customerWaitlistService.cancelEntry({
      privateToken: 'private-first'
    }))).toEqual({ kind: 'cancelled' });
    const result = await load(dashboardService);
    expect(result.kind).toBe('success');
    if (result.kind !== 'success') return;
    expect(result.dashboard.activeEntries.map((entry) => entry.customerName))
      .toEqual(['Small Later']);
    expect(result.dashboard.resolvedToday).toContain(jasmine.objectContaining({
      customerName: 'Large First', partySize: 8, finalStatus: 'cancelled'
    }));
  });

  ['', ' ', 'unknown', 'action-done'].forEach((actionReference) => {
    it(`does not mutate state for stale reference ${JSON.stringify(actionReference)}`, async () => {
      const { dashboardService, customerWaitlistService } = composition();
      const before = await load(dashboardService);

      expect(await resolve(dashboardService, actionReference, 'seated'))
        .toEqual({ kind: 'not-found' });
      expect(await load(dashboardService)).toEqual(before);
      expect(await firstValueFrom(customerWaitlistService.loadPrivateStatus({
        privateToken: 'private-first'
      }))).toEqual({ kind: 'active', restaurantName: 'First Restaurant', position: 1 });
    });
  });

  it('treats non-string runtime action references as not found without mutation', async () => {
    const { dashboardService } = composition();
    const before = await load(dashboardService);

    expect(await firstValueFrom(dashboardService.resolveEntry({
      actionReference: null as unknown as ActiveEntryActionReference,
      resolution: 'seated'
    }))).toEqual({ kind: 'not-found' });
    expect(await load(dashboardService)).toEqual(before);
  });

  it('hides foreign reads and treats a foreign action capability as not found', async () => {
    const { dashboardService, customerWaitlistService } = composition();

    expect(await resolve(dashboardService, 'action-foreign', 'cancelled'))
      .toEqual({ kind: 'not-found' });
    const result = await load(dashboardService);
    expect(JSON.stringify(result)).not.toContain('Foreign');
    expect(await firstValueFrom(customerWaitlistService.loadPrivateStatus({
      privateToken: 'private-foreign'
    }))).toEqual({ kind: 'active', restaurantName: 'Second Restaurant', position: 1 });
  });

  it('releases the normalized phone, rejoins at the tail, and preserves both private views', async () => {
    const { dashboardService, customerWaitlistService } = composition();
    const oldReference = 'action-first';

    await resolve(dashboardService, oldReference, 'no-show');
    await firstValueFrom(customerWaitlistService.lookupPublicRestaurant({
      restaurantSlug: 'first'
    }));
    expect(await firstValueFrom(customerWaitlistService.joinWaitlist({
      customerName: 'Replacement', phone: '555111 1111', partySize: 2
    }))).toEqual({ kind: 'success', privateStatusToken: 'new-private' });
    expect(await firstValueFrom(customerWaitlistService.joinWaitlist({
      customerName: 'Duplicate', phone: '555-111-1111', partySize: 2
    }))).toEqual({ kind: 'duplicate-phone', message: DUPLICATE_PHONE_MESSAGE });

    const dashboard = await load(dashboardService);
    expect(dashboard.kind).toBe('success');
    if (dashboard.kind !== 'success') return;
    expect(dashboard.dashboard.activeEntries.map(({ position, customerName }) => ({
      position, customerName
    }))).toEqual([
      { position: 1, customerName: 'Small Later' },
      { position: 2, customerName: 'Replacement' }
    ]);
    const replacementReference = dashboard.dashboard.activeEntries[1].actionReference;
    expect(replacementReference).toBe('new-action' as ActiveEntryActionReference);
    expect(replacementReference).not.toBe(oldReference as ActiveEntryActionReference);
    expect(JSON.stringify(dashboard)).not.toContain('new-private');
    expect(await firstValueFrom(customerWaitlistService.loadPrivateStatus({
      privateToken: 'private-first'
    }))).toEqual({
      kind: 'resolved', restaurantName: 'First Restaurant', finalStatus: 'no-show'
    });
    expect(await firstValueFrom(customerWaitlistService.loadPrivateStatus({
      privateToken: 'new-private'
    }))).toEqual({ kind: 'active', restaurantName: 'First Restaurant', position: 2 });
  });

  it('never reuses a retired action reference for a later rejoin', async () => {
    const actionReferenceGenerator = jasmine.createSpy()
      .and.returnValues('action-first', 'replacement-action');
    const current = composition({ actionReferenceGenerator });

    await resolve(current.dashboardService, 'action-first', 'seated');
    await firstValueFrom(current.customerWaitlistService.lookupPublicRestaurant({
      restaurantSlug: 'first'
    }));
    expect(await firstValueFrom(current.customerWaitlistService.joinWaitlist({
      customerName: 'Rejected Replacement', phone: '5551111111', partySize: 2
    }))).toEqual({ kind: 'unexpected', message: UNEXPECTED_ERROR_MESSAGE });
    expect(await firstValueFrom(current.customerWaitlistService.joinWaitlist({
      customerName: 'Accepted Replacement', phone: '5551111111', partySize: 2
    }))).toEqual({ kind: 'success', privateStatusToken: 'newer-private' });
    const result = await load(current.dashboardService);
    expect(result.kind === 'success' &&
      result.dashboard.activeEntries.at(-1)?.actionReference)
      .toBe('replacement-action' as ActiveEntryActionReference);
  });

  it('does not accept an action reference that equals a customer private token', async () => {
    const current = composition({
      entries: [],
      privateTokenGenerator: () => 'same-opaque-value',
      actionReferenceGenerator: () => 'same-opaque-value'
    });
    await firstValueFrom(current.customerWaitlistService.lookupPublicRestaurant({
      restaurantSlug: 'first'
    }));

    expect(await firstValueFrom(current.customerWaitlistService.joinWaitlist({
      customerName: 'Collision', phone: '555-4040', partySize: 2
    }))).toEqual({ kind: 'unexpected', message: UNEXPECTED_ERROR_MESSAGE });
    const result = await load(current.dashboardService);
    expect(result.kind === 'success' && result.dashboard.activeEntries).toEqual([]);
  });

  it('rejects an invalid runtime resolution generically without committing it', async () => {
    const { dashboardService } = composition();
    const before = await load(dashboardService);

    expect(await firstValueFrom(dashboardService.resolveEntry({
      actionReference: 'action-first' as ActiveEntryActionReference,
      resolution: 'waiting' as StaffResolution
    }))).toEqual({ kind: 'unexpected', message: UNEXPECTED_ERROR_MESSAGE });
    expect(await load(dashboardService)).toEqual(before);
  });

  it('is cold and emits one asynchronous result then completes per subscription', fakeAsync(() => {
    const beforeDashboardRead = jasmine.createSpy();
    const beforeResolutionCommit = jasmine.createSpy();
    const { dashboardService } = composition({ beforeDashboardRead, beforeResolutionCommit });
    const events: string[] = [];

    const load$ = dashboardService.loadDashboard();
    expect(beforeDashboardRead).not.toHaveBeenCalled();
    load$.subscribe({
      next: () => events.push('load-next'), complete: () => events.push('load-complete')
    });
    load$.subscribe({
      next: () => events.push('load-next'), complete: () => events.push('load-complete')
    });
    expect(events).toEqual([]);
    flushMicrotasks();
    expect(beforeDashboardRead).toHaveBeenCalledTimes(2);
    expect(events).toEqual(['load-next', 'load-complete', 'load-next', 'load-complete']);

    events.length = 0;
    const resolve$ = dashboardService.resolveEntry({
      actionReference: 'action-first' as ActiveEntryActionReference,
      resolution: 'seated'
    });
    expect(beforeResolutionCommit).not.toHaveBeenCalled();
    resolve$.subscribe({
      next: (result) => events.push(result.kind), complete: () => events.push('complete')
    });
    resolve$.subscribe({
      next: (result) => events.push(result.kind), complete: () => events.push('complete')
    });
    expect(events).toEqual([]);
    flushMicrotasks();
    expect(beforeResolutionCommit).toHaveBeenCalledTimes(1);
    expect(events).toEqual(['success', 'complete', 'not-found', 'complete']);
  }));

  it('converts thrown, erroring, and unexpected authorization checks without mutation', async () => {
    const services: RestaurantAccountService[] = [
      { ...accountStub(() => { throw new Error('sensitive thrown detail'); }) },
      { ...accountStub(() => throwError(() => new Error('sensitive stream detail'))) },
      { ...accountStub(() => of({
        kind: 'unexpected', message: UNEXPECTED_ERROR_MESSAGE
      })) }
    ];

    for (const accountService of services) {
      const current = composition({ accountService });
      expect(await load(current.dashboardService)).toEqual({
        kind: 'unexpected', message: UNEXPECTED_ERROR_MESSAGE
      });
      expect(await resolve(current.dashboardService, 'action-first', 'seated')).toEqual({
        kind: 'unexpected', message: UNEXPECTED_ERROR_MESSAGE
      });
      expect(await firstValueFrom(current.customerWaitlistService.loadPrivateStatus({
        privateToken: 'private-first'
      }))).toEqual({ kind: 'active', restaurantName: 'First Restaurant', position: 1 });
    }
  });

  it('converts controlled read and pre-commit faults atomically', async () => {
    const readFault = composition({ beforeDashboardRead: () => {
      throw new Error('sensitive read detail');
    } });
    expect(await load(readFault.dashboardService)).toEqual({
      kind: 'unexpected', message: UNEXPECTED_ERROR_MESSAGE
    });

    const commitFault = composition({ beforeResolutionCommit: () => {
      throw new Error('sensitive commit detail');
    } });
    const before = await load(commitFault.dashboardService);
    expect(await resolve(commitFault.dashboardService, 'action-first', 'seated')).toEqual({
      kind: 'unexpected', message: UNEXPECTED_ERROR_MESSAGE
    });
    expect(await load(commitFault.dashboardService)).toEqual(before);
    expect(await firstValueFrom(commitFault.customerWaitlistService.loadPrivateStatus({
      privateToken: 'private-first'
    }))).toEqual({ kind: 'active', restaurantName: 'First Restaurant', position: 1 });
    await firstValueFrom(commitFault.customerWaitlistService.lookupPublicRestaurant({
      restaurantSlug: 'first'
    }));
    expect((await firstValueFrom(commitFault.customerWaitlistService.joinWaitlist({
      customerName: 'Duplicate', phone: '5551111111', partySize: 2
    }))).kind).toBe('duplicate-phone');
  });

  function accountStub(
    access: () => Observable<DashboardAccessResult>
  ): RestaurantAccountService {
    return {
      signup: () => of({ kind: 'unexpected', message: UNEXPECTED_ERROR_MESSAGE }),
      verify: () => of({ kind: 'unexpected', message: UNEXPECTED_ERROR_MESSAGE }),
      checkDashboardAccess: () => defer(access)
    };
  }
});
