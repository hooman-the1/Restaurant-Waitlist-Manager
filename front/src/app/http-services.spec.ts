import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting
} from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { firstValueFrom, Observable } from 'rxjs';

import {
  DUPLICATE_PHONE_MESSAGE,
  UNEXPECTED_ERROR_MESSAGE
} from './api-contracts';
import { API_BASE_URL } from './api-base-url';
import { HttpCustomerWaitlistService } from './http-customer-waitlist.service';
import { HttpRestaurantAccountService } from './http-restaurant-account.service';
import { HttpRestaurantDashboardService } from './http-restaurant-dashboard.service';

const baseUrl = 'http://api.example';
const unexpected = {
  kind: 'unexpected',
  message: UNEXPECTED_ERROR_MESSAGE
} as const;

describe('HTTP service adapters', () => {
  let http: HttpTestingController;
  let account: HttpRestaurantAccountService;
  let dashboard: HttpRestaurantDashboardService;
  let customer: HttpCustomerWaitlistService;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: API_BASE_URL, useValue: `${baseUrl}///` },
        HttpRestaurantAccountService,
        HttpRestaurantDashboardService,
        HttpCustomerWaitlistService
      ]
    });
    http = TestBed.inject(HttpTestingController);
    account = TestBed.inject(HttpRestaurantAccountService);
    dashboard = TestBed.inject(HttpRestaurantDashboardService);
    customer = TestBed.inject(HttpCustomerWaitlistService);
  });

  afterEach(() => http.verify());

  it('sends all account and dashboard requests with exact transport contracts', async () => {
    const signup = firstValueFrom(
      account.signup({
        restaurantName: 'Cafe',
        email: 'owner@example.com',
        password: 'secret-value'
      })
    );
    expectRequest('POST', '/api/restaurants', {
      restaurantName: 'Cafe',
      email: 'owner@example.com',
      password: 'secret-value'
    }).flush({ kind: 'success' }, { status: 201, statusText: 'Created' });
    expect(await signup).toEqual({ kind: 'success' });

    const verify = firstValueFrom(account.verify({ token: 'opaque-token' }));
    expectRequest('POST', '/api/restaurant-verifications', {
      token: 'opaque-token'
    }).flush({ kind: 'success' }, { status: 200, statusText: 'OK' });
    expect(await verify).toEqual({ kind: 'success' });

    const access = firstValueFrom(account.checkDashboardAccess());
    expectRequest('GET', '/api/restaurant-session').flush(
      { kind: 'allowed' },
      { status: 200, statusText: 'OK' }
    );
    expect(await access).toEqual({ kind: 'allowed' });

    const load = firstValueFrom(dashboard.loadDashboard());
    expectRequest('GET', '/api/dashboard').flush(
      {
        kind: 'success',
        dashboard: {
          restaurantName: 'Cafe',
          activeEntries: [
            {
              position: 1,
              customerName: 'Morgan',
              phone: '555-0100',
              partySize: 2,
              actionReference: 'action-reference'
            }
          ],
          resolvedToday: [
            { customerName: 'Alex', partySize: 4, finalStatus: 'seated' }
          ]
        }
      },
      { status: 200, statusText: 'OK' }
    );
    expect((await load).kind).toBe('success');

    const resolve = firstValueFrom(
      dashboard.resolveEntry({
        actionReference: 'A/B%+?# É中' as never,
        resolution: 'no-show'
      })
    );
    expectRequest(
      'PATCH',
      `/api/dashboard/waitlist-entries/${encodeURIComponent('A/B%+?# É中')}`,
      { resolution: 'no-show' }
    ).flush({ kind: 'success' }, { status: 200, statusText: 'OK' });
    expect(await resolve).toEqual({ kind: 'success' });
  });

  it('sends all customer requests with exact encoded URLs, bodies, and credentials', async () => {
    const slug = ' A/B%+?# É中 ';
    const lookup = firstValueFrom(customer.lookupPublicRestaurant({ restaurantSlug: slug }));
    expectRequest('GET', `/api/restaurants/${encodeURIComponent(slug)}`).flush(
      { kind: 'success', restaurant: { restaurantName: 'Exact Cafe' } },
      { status: 200, statusText: 'OK' }
    );
    expect(await lookup).toEqual({
      kind: 'success',
      restaurant: { restaurantName: 'Exact Cafe' }
    });

    const joinInput = { customerName: 'Name', phone: '555', partySize: 3 };
    const join = firstValueFrom(customer.joinWaitlist(joinInput));
    expectRequest(
      'POST',
      `/api/restaurants/${encodeURIComponent(slug)}/waitlist-entries`,
      joinInput
    ).flush(
      { kind: 'success', privateStatusToken: 'private-token' },
      { status: 201, statusText: 'Created' }
    );
    expect(await join).toEqual({ kind: 'success', privateStatusToken: 'private-token' });

    const privateToken = ' P/T%+?# É中 ';
    const status = firstValueFrom(customer.loadPrivateStatus({ privateToken }));
    expectRequest('GET', `/api/waitlist-entries/${encodeURIComponent(privateToken)}`).flush(
      { kind: 'active', restaurantName: 'Exact Cafe', position: 1 },
      { status: 200, statusText: 'OK' }
    );
    expect(await status).toEqual({
      kind: 'active',
      restaurantName: 'Exact Cafe',
      position: 1
    });

    const resolvedStatus = firstValueFrom(customer.loadPrivateStatus({ privateToken }));
    expectRequest('GET', `/api/waitlist-entries/${encodeURIComponent(privateToken)}`).flush(
      { kind: 'resolved', restaurantName: 'Exact Cafe', finalStatus: 'no-show' },
      { status: 200, statusText: 'OK' }
    );
    expect(await resolvedStatus).toEqual({
      kind: 'resolved', restaurantName: 'Exact Cafe', finalStatus: 'no-show'
    });

    const cancel = firstValueFrom(customer.cancelEntry({ privateToken }));
    const cancellation = expectRequest(
      'POST',
      `/api/waitlist-entries/${encodeURIComponent(privateToken)}/cancellations`
    );
    expect(cancellation.request.body).toBeNull();
    cancellation.flush({ kind: 'cancelled' }, { status: 200, statusText: 'OK' });
    expect(await cancel).toEqual({ kind: 'cancelled' });
  });

  it('requires a current successful lookup and protects selection from stale or cancelled lookups', async () => {
    expect(await firstValueFrom(customer.joinWaitlist({
      customerName: 'No selection', phone: '1', partySize: 1
    }))).toEqual({ kind: 'not-found' });
    http.expectNone((request) => request.url.includes('/waitlist-entries'));

    const firstResult: unknown[] = [];
    const secondResult: unknown[] = [];
    customer.lookupPublicRestaurant({ restaurantSlug: 'first' }).subscribe((value) =>
      firstResult.push(value)
    );
    const first = http.expectOne(`${baseUrl}/api/restaurants/first`);
    customer.lookupPublicRestaurant({ restaurantSlug: 'second' }).subscribe((value) =>
      secondResult.push(value)
    );
    const second = http.expectOne(`${baseUrl}/api/restaurants/second`);
    second.flush(
      { kind: 'success', restaurant: { restaurantName: 'Second' } },
      { status: 200, statusText: 'OK' }
    );
    first.flush(
      { kind: 'success', restaurant: { restaurantName: 'First' } },
      { status: 200, statusText: 'OK' }
    );
    expect(firstResult).toEqual([
      { kind: 'success', restaurant: { restaurantName: 'First' } }
    ]);
    expect(secondResult).toEqual([
      { kind: 'success', restaurant: { restaurantName: 'Second' } }
    ]);

    const joined = firstValueFrom(customer.joinWaitlist({
      customerName: 'Selected', phone: '2', partySize: 2
    }));
    expectRequest('POST', '/api/restaurants/second/waitlist-entries', {
      customerName: 'Selected', phone: '2', partySize: 2
    }).flush(
      { kind: 'success', privateStatusToken: 'joined' },
      { status: 201, statusText: 'Created' }
    );
    expect((await joined).kind).toBe('success');

    const cancelledLookup = customer
      .lookupPublicRestaurant({ restaurantSlug: 'cancelled' })
      .subscribe();
    const cancelledRequest = http.expectOne(`${baseUrl}/api/restaurants/cancelled`);
    cancelledLookup.unsubscribe();
    expect(cancelledRequest.cancelled).toBeTrue();
    expect(await firstValueFrom(customer.joinWaitlist({
      customerName: 'After cancel', phone: '3', partySize: 3
    }))).toEqual({ kind: 'not-found' });

    const mutableLookup = { restaurantSlug: 'original' };
    const originalLookup = firstValueFrom(customer.lookupPublicRestaurant(mutableLookup));
    const originalRequest = http.expectOne(`${baseUrl}/api/restaurants/original`);
    mutableLookup.restaurantSlug = 'changed';
    originalRequest.flush(
      { kind: 'success', restaurant: { restaurantName: 'Original' } },
      { status: 200, statusText: 'OK' }
    );
    await originalLookup;
    const originalJoin = firstValueFrom(customer.joinWaitlist({
      customerName: 'Original selection', phone: '4', partySize: 4
    }));
    expectRequest('POST', '/api/restaurants/original/waitlist-entries', {
      customerName: 'Original selection', phone: '4', partySize: 4
    }).flush(
      { kind: 'success', privateStatusToken: 'original-join' },
      { status: 201, statusText: 'Created' }
    );
    expect((await originalJoin).kind).toBe('success');
  });

  it('maps every documented HTTP failure to its exact method-specific result', async () => {
    await expectHttpFailure(
      account.signup({ restaurantName: 'A', email: 'a@b.co', password: 'password' }),
      'POST', '/api/restaurants', 400, { kind: 'validation', message: 'Invalid request.' }
    );
    await expectHttpFailure(
      account.signup({ restaurantName: 'A', email: 'a@b.co', password: 'password' }),
      'POST', '/api/restaurants', 409, { kind: 'validation', message: 'Conflict.' }
    );
    await expectHttpFailure(
      account.verify({ token: 'x' }), 'POST', '/api/restaurant-verifications', 400,
      { kind: 'invalid-or-used-token' }
    );
    await expectHttpFailure(
      account.checkDashboardAccess(), 'GET', '/api/restaurant-session', 401,
      { kind: 'unauthorized' }
    );
    await expectHttpFailure(
      dashboard.loadDashboard(), 'GET', '/api/dashboard', 401,
      { kind: 'unauthorized' }
    );
    await expectHttpFailure(
      dashboard.resolveEntry({ actionReference: 'a' as never, resolution: 'seated' }),
      'PATCH', '/api/dashboard/waitlist-entries/a', 401, { kind: 'unauthorized' }
    );
    await expectHttpFailure(
      dashboard.resolveEntry({ actionReference: 'a' as never, resolution: 'seated' }),
      'PATCH', '/api/dashboard/waitlist-entries/a', 404, { kind: 'not-found' }
    );
    await expectHttpFailure(
      dashboard.resolveEntry({ actionReference: 'a' as never, resolution: 'seated' }),
      'PATCH', '/api/dashboard/waitlist-entries/a', 400,
      { kind: 'validation', message: 'Invalid request.' }, unexpected
    );
    await expectHttpFailure(
      customer.lookupPublicRestaurant({ restaurantSlug: 'missing' }),
      'GET', '/api/restaurants/missing', 404, { kind: 'not-found' }
    );

    await selectRestaurant('selected');
    for (const [status, body] of [
      [400, { kind: 'validation', message: 'Invalid request.' }],
      [404, { kind: 'not-found' }],
      [409, { kind: 'duplicate-phone', message: DUPLICATE_PHONE_MESSAGE }]
    ] as const) {
      await expectHttpFailure(
        customer.joinWaitlist({ customerName: 'A', phone: '1', partySize: 1 }),
        'POST', '/api/restaurants/selected/waitlist-entries', status, body
      );
    }
    await expectHttpFailure(
      customer.loadPrivateStatus({ privateToken: 'missing' }),
      'GET', '/api/waitlist-entries/missing', 404, { kind: 'not-found' }
    );
    await expectHttpFailure(
      customer.cancelEntry({ privateToken: 'missing' }),
      'POST', '/api/waitlist-entries/missing/cancellations', 404,
      { kind: 'not-found' }
    );
  });

  it('maps documented 500s and protocol, malformed, network, and wrong-status failures to one completed unexpected result', async () => {
    const operations: Array<() => Observable<unknown>> = [
      () => account.signup({ restaurantName: 'A', email: 'a@b.co', password: 'password' }),
      () => account.verify({ token: 'x' }),
      () => account.checkDashboardAccess(),
      () => dashboard.loadDashboard(),
      () => dashboard.resolveEntry({ actionReference: 'a' as never, resolution: 'seated' }),
      () => customer.lookupPublicRestaurant({ restaurantSlug: 'slug' }),
      () => customer.loadPrivateStatus({ privateToken: 'token' }),
      () => customer.cancelEntry({ privateToken: 'token' })
    ];
    for (const operation of operations) {
      const events: unknown[] = [];
      operation().subscribe({
        next: (value) => events.push(value),
        error: (error) => events.push(error),
        complete: () => events.push('complete')
      });
      const pending = http.match(() => true);
      expect(pending).toHaveSize(1);
      pending[0].flush(unexpected, { status: 500, statusText: 'Error' });
      expect(events).toEqual([unexpected, 'complete']);
    }

    await selectRestaurant('selected');
    const joinEvents: unknown[] = [];
    customer.joinWaitlist({ customerName: 'A', phone: '1', partySize: 1 }).subscribe({
      next: (value) => joinEvents.push(value),
      complete: () => joinEvents.push('complete')
    });
    http.expectOne(`${baseUrl}/api/restaurants/selected/waitlist-entries`).flush(
      unexpected,
      { status: 500, statusText: 'Error' }
    );
    expect(joinEvents).toEqual([unexpected, 'complete']);

    const malformed = firstValueFrom(account.checkDashboardAccess());
    http.expectOne(`${baseUrl}/api/restaurant-session`).flush(
      { kind: 'allowed', extra: true },
      { status: 200, statusText: 'OK' }
    );
    expect(await malformed).toEqual(unexpected);

    const empty = firstValueFrom(account.checkDashboardAccess());
    http.expectOne(`${baseUrl}/api/restaurant-session`).flush(
      null,
      { status: 200, statusText: 'OK' }
    );
    expect(await empty).toEqual(unexpected);

    const nonJsonShape = firstValueFrom(account.checkDashboardAccess());
    http.expectOne(`${baseUrl}/api/restaurant-session`).flush(
      'not-json-object',
      { status: 200, statusText: 'OK' }
    );
    expect(await nonJsonShape).toEqual(unexpected);

    const malformedLookup = firstValueFrom(
      customer.lookupPublicRestaurant({ restaurantSlug: 'malformed' })
    );
    http.expectOne(`${baseUrl}/api/restaurants/malformed`).flush(
      { kind: 'success', restaurant: { restaurantName: 'Cafe', extra: true } },
      { status: 200, statusText: 'OK' }
    );
    expect(await malformedLookup).toEqual(unexpected);
    expect(await firstValueFrom(customer.joinWaitlist({
      customerName: 'No selection', phone: '1', partySize: 1
    }))).toEqual({ kind: 'not-found' });

    const wrongStatus = firstValueFrom(account.checkDashboardAccess());
    http.expectOne(`${baseUrl}/api/restaurant-session`).flush(
      { kind: 'allowed' },
      { status: 201, statusText: 'Created' }
    );
    expect(await wrongStatus).toEqual(unexpected);

    const wrongKind = firstValueFrom(account.checkDashboardAccess());
    http.expectOne(`${baseUrl}/api/restaurant-session`).flush(
      { kind: 'not-found' },
      { status: 401, statusText: 'Unauthorized' }
    );
    expect(await wrongKind).toEqual(unexpected);

    const networkEvents: unknown[] = [];
    account.checkDashboardAccess().subscribe({
      next: (value) => networkEvents.push(value),
      error: (error) => networkEvents.push(error),
      complete: () => networkEvents.push('complete')
    });
    http.expectOne(`${baseUrl}/api/restaurant-session`).error(
      new ProgressEvent('network')
    );
    expect(networkEvents).toEqual([unexpected, 'complete']);
  });

  it('is cold per subscription and aborts without emission on unsubscribe', () => {
    const stream = account.checkDashboardAccess();
    http.expectNone(`${baseUrl}/api/restaurant-session`);
    const firstEvents: unknown[] = [];
    const first = stream.subscribe((value) => firstEvents.push(value));
    const firstRequest = http.expectOne(`${baseUrl}/api/restaurant-session`);
    const second = stream.subscribe();
    const requests = http.match(`${baseUrl}/api/restaurant-session`);
    expect(requests).toHaveSize(1);
    first.unsubscribe();
    second.unsubscribe();
    expect(firstRequest.cancelled).toBeTrue();
    expect(requests[0].cancelled).toBeTrue();
    expect(firstEvents).toEqual([]);
  });

  function expectRequest(method: string, path: string, body?: unknown) {
    const pending = http.expectOne(`${baseUrl}${path}`);
    expect(pending.request.method).toBe(method);
    expect(pending.request.withCredentials).toBeTrue();
    if (body !== undefined) {
      expect(pending.request.body).toEqual(body);
    } else if (method === 'GET') {
      expect(pending.request.body).toBeNull();
    }
    return pending;
  }

  async function selectRestaurant(slug: string): Promise<void> {
    const selected = firstValueFrom(customer.lookupPublicRestaurant({ restaurantSlug: slug }));
    expectRequest('GET', `/api/restaurants/${encodeURIComponent(slug)}`).flush(
      { kind: 'success', restaurant: { restaurantName: 'Selected' } },
      { status: 200, statusText: 'OK' }
    );
    await selected;
  }

  async function expectHttpFailure(
    observable: Observable<unknown>,
    method: string,
    path: string,
    status: number,
    body: object,
    expected: unknown = body
  ): Promise<void> {
    const events: unknown[] = [];
    observable.subscribe({
      next: (value) => events.push(value),
      error: (error) => events.push(error),
      complete: () => events.push('complete')
    });
    expectRequest(method, path).flush(body, { status, statusText: 'Error' });
    expect(events).toEqual([expected, 'complete']);
  }
});
