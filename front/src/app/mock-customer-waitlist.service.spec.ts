import { fakeAsync, flushMicrotasks, TestBed } from '@angular/core/testing';
import { firstValueFrom } from 'rxjs';

import { appConfig } from './app.config';
import {
  DUPLICATE_PHONE_MESSAGE,
  FinalStatus,
  JoinWaitlistInput,
  UNEXPECTED_ERROR_MESSAGE
} from './api-contracts';
import {
  MockCustomerWaitlistService,
  MockCustomerWaitlistTestOptions
} from './mock-customer-waitlist.service';
import { CUSTOMER_WAITLIST_SERVICE, CustomerWaitlistService } from './service-boundary';

describe('MockCustomerWaitlistService', () => {
  const validJoin: JoinWaitlistInput = {
    customerName: 'A Customer',
    phone: '555-1234',
    partySize: 2
  };

  const isolatedService = (options: MockCustomerWaitlistTestOptions = {}) =>
    MockCustomerWaitlistService.createForTesting({
      restaurants: [{ slug: 'first', restaurantName: 'First Restaurant' }],
      privateTokenGenerator: jasmine.createSpy().and.returnValues('token-1', 'token-2'),
      ...options
    });

  const select = (service: MockCustomerWaitlistService, restaurantSlug = 'first') =>
    firstValueFrom(service.lookupPublicRestaurant({ restaurantSlug }));

  const join = (
    service: MockCustomerWaitlistService,
    overrides: Partial<JoinWaitlistInput> = {}
  ) => firstValueFrom(service.joinWaitlist({ ...validJoin, ...overrides }));

  it('registers exactly one concrete mock behind the customer-waitlist token', () => {
    TestBed.configureTestingModule({ providers: appConfig.providers });

    const service = TestBed.inject(CUSTOMER_WAITLIST_SERVICE);

    expect(service instanceof MockCustomerWaitlistService).toBeTrue();
  });

  it('loads the privacy-minimal active status created through the shared public service', async () => {
    const concreteService = isolatedService();
    const service: CustomerWaitlistService = concreteService;
    await firstValueFrom(service.lookupPublicRestaurant({ restaurantSlug: 'first' }));
    const joined = await firstValueFrom(service.joinWaitlist(validJoin));

    expect(joined.kind).toBe('success');
    if (joined.kind === 'success') {
      const result = await firstValueFrom(
        service.loadPrivateStatus({ privateToken: joined.privateStatusToken })
      );
      expect(result).toEqual({
        kind: 'active',
        restaurantName: 'First Restaurant',
        position: 1
      });
      expect(Object.keys(result)).toEqual(['kind', 'restaurantName', 'position']);
      expect(JSON.stringify(result)).not.toContain(validJoin.customerName);
      expect(JSON.stringify(result)).not.toContain(validJoin.phone);
      expect(JSON.stringify(result)).not.toContain(joined.privateStatusToken);
    }
  });

  it('cancels an active entry once and keeps its token as a resolved lookup', async () => {
    const service = isolatedService();
    await select(service);
    const joined = await join(service);

    expect(joined.kind).toBe('success');
    if (joined.kind === 'success') {
      expect(
        await firstValueFrom(service.cancelEntry({ privateToken: joined.privateStatusToken }))
      ).toEqual({ kind: 'cancelled' });
      expect(
        await firstValueFrom(service.loadPrivateStatus({ privateToken: joined.privateStatusToken }))
      ).toEqual({
        kind: 'resolved',
        restaurantName: 'First Restaurant',
        finalStatus: 'cancelled'
      });
      expect(
        await firstValueFrom(service.cancelEntry({ privateToken: joined.privateStatusToken }))
      ).toEqual({ kind: 'not-found' });
    }
  });

  it('calculates gapless active-only FIFO positions within each restaurant', async () => {
    const service: CustomerWaitlistService = isolatedService({
      restaurants: [
        { slug: 'first', restaurantName: 'First Restaurant' },
        { slug: 'second', restaurantName: 'Second Restaurant' }
      ],
      entries: [
        {
          restaurantSlug: 'first', customerName: 'Resolved first', phone: '100',
          partySize: 30, status: 'seated', privateStatusToken: 'resolved-before'
        },
        {
          restaurantSlug: 'first', customerName: 'Active first', phone: '101',
          partySize: 9, status: 'active', privateStatusToken: 'active-first'
        },
        {
          restaurantSlug: 'second', customerName: 'Other', phone: '101',
          partySize: 1, status: 'active', privateStatusToken: 'other-active'
        },
        {
          restaurantSlug: 'first', customerName: 'Resolved between', phone: '102',
          partySize: 1, status: 'no-show', privateStatusToken: 'resolved-between'
        },
        {
          restaurantSlug: 'first', customerName: 'Active second', phone: '103',
          partySize: 1, status: 'active', privateStatusToken: 'active-second'
        }
      ]
    });

    expect(await firstValueFrom(service.loadPrivateStatus({ privateToken: 'active-first' })))
      .toEqual({ kind: 'active', restaurantName: 'First Restaurant', position: 1 });
    expect(await firstValueFrom(service.loadPrivateStatus({ privateToken: 'active-second' })))
      .toEqual({ kind: 'active', restaurantName: 'First Restaurant', position: 2 });
    expect(await firstValueFrom(service.loadPrivateStatus({ privateToken: 'other-active' })))
      .toEqual({ kind: 'active', restaurantName: 'Second Restaurant', position: 1 });
  });

  (['seated', 'cancelled', 'no-show'] as const).forEach((finalStatus) => {
    it(`loads an exact privacy-minimal ${finalStatus} result`, async () => {
      const service: CustomerWaitlistService = isolatedService({
        entries: [{
          restaurantSlug: 'first', customerName: 'Private Name', phone: '555-9876',
          partySize: 12, status: finalStatus, privateStatusToken: `private-${finalStatus}`
        }]
      });

      const result = await firstValueFrom(
        service.loadPrivateStatus({ privateToken: `private-${finalStatus}` })
      );

      expect(result).toEqual({
        kind: 'resolved', restaurantName: 'First Restaurant', finalStatus
      });
      expect(Object.keys(result)).toEqual(['kind', 'restaurantName', 'finalStatus']);
      expect(JSON.stringify(result)).not.toContain('Private Name');
      expect(JSON.stringify(result)).not.toContain('555');
      expect(JSON.stringify(result)).not.toContain(`private-${finalStatus}`);
    });
  });

  ['', ' ', 'malformed/token', 'unknown'].forEach((privateToken) => {
    it(`returns an exact not-found result without mutation for token ${JSON.stringify(privateToken)}`, async () => {
      const service = isolatedService({
        entries: [{
          restaurantSlug: 'first', customerName: 'Existing', phone: '555-1234',
          partySize: 2, status: 'active', privateStatusToken: 'known-token'
        }]
      });
      const before = service.getSnapshotForTesting();

      const result = await firstValueFrom(service.loadPrivateStatus({ privateToken }));

      expect(result).toEqual({ kind: 'not-found' });
      expect(Object.keys(result)).toEqual(['kind']);
      expect(service.getSnapshotForTesting()).toEqual(before);
    });
  });

  (['seated', 'cancelled', 'no-show'] as readonly FinalStatus[]).forEach((status) => {
    it(`does not cancel an entry already resolved as ${status}`, async () => {
      const service = isolatedService({
        entries: [{
          restaurantSlug: 'first', customerName: 'Resolved', phone: '555-1234',
          partySize: 2, status, privateStatusToken: 'resolved-token'
        }]
      });
      const before = service.getSnapshotForTesting();

      expect(await firstValueFrom(service.cancelEntry({ privateToken: 'resolved-token' })))
        .toEqual({ kind: 'not-found' });
      expect(service.getSnapshotForTesting()).toEqual(before);
    });
  });

  it('does not cancel an empty, malformed, or unknown token', async () => {
    const service = isolatedService();
    const before = service.getSnapshotForTesting();

    for (const privateToken of ['', 'bad/token', 'unknown']) {
      expect(await firstValueFrom(service.cancelEntry({ privateToken })))
        .toEqual({ kind: 'not-found' });
    }
    expect(service.getSnapshotForTesting()).toEqual(before);
  });

  it('recalculates only later positions in the cancelled entry restaurant', async () => {
    const service: CustomerWaitlistService = isolatedService({
      restaurants: [
        { slug: 'first', restaurantName: 'First Restaurant' },
        { slug: 'second', restaurantName: 'Second Restaurant' }
      ],
      entries: [
        { restaurantSlug: 'first', customerName: 'A', phone: '1', partySize: 1, status: 'active', privateStatusToken: 'a' },
        { restaurantSlug: 'second', customerName: 'X', phone: '1', partySize: 30, status: 'active', privateStatusToken: 'x' },
        { restaurantSlug: 'first', customerName: 'B', phone: '2', partySize: 30, status: 'active', privateStatusToken: 'b' },
        { restaurantSlug: 'first', customerName: 'C', phone: '3', partySize: 1, status: 'active', privateStatusToken: 'c' }
      ]
    });

    expect(await firstValueFrom(service.cancelEntry({ privateToken: 'b' })))
      .toEqual({ kind: 'cancelled' });
    expect(await firstValueFrom(service.loadPrivateStatus({ privateToken: 'a' })))
      .toEqual({ kind: 'active', restaurantName: 'First Restaurant', position: 1 });
    expect(await firstValueFrom(service.loadPrivateStatus({ privateToken: 'c' })))
      .toEqual({ kind: 'active', restaurantName: 'First Restaurant', position: 2 });
    expect(await firstValueFrom(service.loadPrivateStatus({ privateToken: 'x' })))
      .toEqual({ kind: 'active', restaurantName: 'Second Restaurant', position: 1 });
  });

  it('releases only the cancelled phone, rejoins at the end, and renews duplicate rejection', async () => {
    const service: CustomerWaitlistService = isolatedService({
      entries: [
        { restaurantSlug: 'first', customerName: 'Original', phone: '(555) 123-4567', partySize: 2, status: 'active', privateStatusToken: 'old-token' },
        { restaurantSlug: 'first', customerName: 'Waiting', phone: '555-0000', partySize: 2, status: 'active', privateStatusToken: 'waiting-token' }
      ],
      privateTokenGenerator: jasmine.createSpy().and.returnValue('replacement-token')
    });

    expect(await firstValueFrom(service.cancelEntry({ privateToken: 'old-token' })))
      .toEqual({ kind: 'cancelled' });
    await firstValueFrom(service.lookupPublicRestaurant({ restaurantSlug: 'first' }));
    expect(await firstValueFrom(service.joinWaitlist({
      customerName: 'Rejoined', phone: '555123 4567', partySize: 4
    }))).toEqual({ kind: 'success', privateStatusToken: 'replacement-token' });
    expect(await firstValueFrom(service.loadPrivateStatus({ privateToken: 'old-token' })))
      .toEqual({ kind: 'resolved', restaurantName: 'First Restaurant', finalStatus: 'cancelled' });
    expect(await firstValueFrom(service.loadPrivateStatus({ privateToken: 'replacement-token' })))
      .toEqual({ kind: 'active', restaurantName: 'First Restaurant', position: 2 });

    const duplicate = await firstValueFrom(service.joinWaitlist({
      customerName: 'Again', phone: '555-123-4567', partySize: 1
    }));
    expect(duplicate).toEqual({ kind: 'duplicate-phone', message: DUPLICATE_PHONE_MESSAGE });
    expect(JSON.stringify(duplicate)).not.toContain('old-token');
    expect(JSON.stringify(duplicate)).not.toContain('replacement-token');
  });

  it('converts private lookup faults to a generic result without state changes', async () => {
    const service = isolatedService({
      entries: [{
        restaurantSlug: 'first', customerName: 'Secret', phone: '555-1234',
        partySize: 2, status: 'active', privateStatusToken: 'known-token'
      }],
      beforePrivateStatusLookup: () => { throw new Error('sensitive lookup detail'); }
    });
    const before = service.getSnapshotForTesting();

    expect(await firstValueFrom(service.loadPrivateStatus({ privateToken: 'known-token' })))
      .toEqual({ kind: 'unexpected', message: UNEXPECTED_ERROR_MESSAGE });
    expect(service.getSnapshotForTesting()).toEqual(before);
  });

  it('converts cancellation faults atomically without releasing the phone or changing FIFO', async () => {
    const service = isolatedService({
      entries: [
        { restaurantSlug: 'first', customerName: 'Target', phone: '555-1234', partySize: 2, status: 'active', privateStatusToken: 'target-token' },
        { restaurantSlug: 'first', customerName: 'Later', phone: '555-0000', partySize: 2, status: 'active', privateStatusToken: 'later-token' }
      ],
      beforeCancelCommit: () => { throw new Error('sensitive cancellation detail'); }
    });
    const before = service.getSnapshotForTesting();

    expect(await firstValueFrom(service.cancelEntry({ privateToken: 'target-token' })))
      .toEqual({ kind: 'unexpected', message: UNEXPECTED_ERROR_MESSAGE });
    expect(service.getSnapshotForTesting()).toEqual(before);
    expect(await firstValueFrom(service.loadPrivateStatus({ privateToken: 'target-token' })))
      .toEqual({ kind: 'active', restaurantName: 'First Restaurant', position: 1 });
    expect(await firstValueFrom(service.loadPrivateStatus({ privateToken: 'later-token' })))
      .toEqual({ kind: 'active', restaurantName: 'First Restaurant', position: 2 });
    await select(service);
    expect(await join(service)).toEqual({
      kind: 'duplicate-phone', message: DUPLICATE_PHONE_MESSAGE
    });
  });

  it('performs each private operation only upon each subscription', fakeAsync(() => {
    const lookupHook = jasmine.createSpy();
    const service = isolatedService({
      entries: [{
        restaurantSlug: 'first', customerName: 'Target', phone: '555-1234',
        partySize: 2, status: 'active', privateStatusToken: 'target-token'
      }],
      beforePrivateStatusLookup: lookupHook
    });
    const statusResults: string[] = [];
    const status$ = service.loadPrivateStatus({ privateToken: 'target-token' });

    expect(lookupHook).not.toHaveBeenCalled();
    status$.subscribe((result) => statusResults.push(result.kind));
    status$.subscribe((result) => statusResults.push(result.kind));
    expect(lookupHook).toHaveBeenCalledTimes(2);
    expect(statusResults).toEqual([]);
    flushMicrotasks();
    expect(lookupHook).toHaveBeenCalledTimes(2);
    expect(statusResults).toEqual(['active', 'active']);

    const cancellationResults: string[] = [];
    const cancellation$ = service.cancelEntry({ privateToken: 'target-token' });
    expect(service.getSnapshotForTesting().entries[0].status).toBe('active');
    cancellation$.subscribe((result) => cancellationResults.push(result.kind));
    cancellation$.subscribe((result) => cancellationResults.push(result.kind));
    expect(service.getSnapshotForTesting().entries[0].status).toBe('cancelled');
    expect(cancellationResults).toEqual([]);
    flushMicrotasks();
    expect(cancellationResults).toEqual(['cancelled', 'not-found']);
    expect(service.getSnapshotForTesting().entries[0].status).toBe('cancelled');
  }));

  it('looks up only the exact default public restaurant and exposes only its name', async () => {
    const service = MockCustomerWaitlistService.createDefault();

    expect(
      await firstValueFrom(
        service.lookupPublicRestaurant({ restaurantSlug: 'demo-restaurant' })
      )
    ).toEqual({
      kind: 'success',
      restaurant: { restaurantName: 'Demo Restaurant' }
    });
  });

  ['', ' demo-restaurant', 'demo-restaurant ', 'Demo-Restaurant', 'unknown'].forEach(
    (restaurantSlug) => {
      it(`does not find the non-exact slug ${JSON.stringify(restaurantSlug)}`, async () => {
        const service = MockCustomerWaitlistService.createDefault();

        expect(
          await firstValueFrom(service.lookupPublicRestaurant({ restaurantSlug }))
        ).toEqual({ kind: 'not-found' });
        expect(service.getSnapshotForTesting().entries).toEqual([]);
      });
    }
  );

  it('is cold, emits one asynchronous result, and completes for every operation', fakeAsync(() => {
    const tokenGenerator = jasmine.createSpy().and.returnValue('token-1');
    const service = isolatedService({ privateTokenGenerator: tokenGenerator });
    const events: string[] = [];

    const lookup$ = service.lookupPublicRestaurant({ restaurantSlug: 'first' });
    expect(service.getSnapshotForTesting().selectedRestaurantSlug).toBeUndefined();
    lookup$.subscribe({
      next: () => events.push('lookup-next'),
      complete: () => events.push('lookup-complete')
    });
    expect(events).toEqual([]);
    flushMicrotasks();
    expect(events).toEqual(['lookup-next', 'lookup-complete']);

    events.length = 0;
    const join$ = service.joinWaitlist(validJoin);
    expect(tokenGenerator).not.toHaveBeenCalled();
    expect(service.getSnapshotForTesting().entries).toEqual([]);
    join$.subscribe({
      next: () => events.push('join-next'),
      complete: () => events.push('join-complete')
    });
    expect(events).toEqual([]);
    flushMicrotasks();
    expect(events).toEqual(['join-next', 'join-complete']);
    expect(service.getSnapshotForTesting().entries.length).toBe(1);

    events.length = 0;
    service.loadPrivateStatus({ privateToken: 'token-1' }).subscribe({
      next: () => events.push('status-next'),
      complete: () => events.push('status-complete')
    });
    expect(events).toEqual([]);
    flushMicrotasks();
    expect(events).toEqual(['status-next', 'status-complete']);

    events.length = 0;
    service.cancelEntry({ privateToken: 'token-1' }).subscribe({
      next: () => events.push('cancel-next'),
      complete: () => events.push('cancel-complete')
    });
    expect(events).toEqual([]);
    flushMicrotasks();
    expect(events).toEqual(['cancel-next', 'cancel-complete']);
  }));

  it('requires a successful lookup on the same instance and clears stale selection on misses', async () => {
    const service = isolatedService();

    expect(await join(service)).toEqual({ kind: 'not-found' });
    expect(await select(service)).toEqual({
      kind: 'success',
      restaurant: { restaurantName: 'First Restaurant' }
    });
    expect(await select(service, 'missing')).toEqual({ kind: 'not-found' });
    expect(await join(service)).toEqual({ kind: 'not-found' });
    expect(service.getSnapshotForTesting().entries).toEqual([]);
  });

  it('replaces the selected restaurant after a later successful lookup', async () => {
    const service = isolatedService({
      restaurants: [
        { slug: 'first', restaurantName: 'First Restaurant' },
        { slug: 'second', restaurantName: 'Second Restaurant' }
      ]
    });

    await select(service, 'first');
    await select(service, 'second');
    expect(await join(service)).toEqual({
      kind: 'success',
      privateStatusToken: 'token-1'
    });
    expect(service.getSnapshotForTesting().entries[0].restaurantSlug).toBe('second');
  });

  it('retains a nonblank customer name exactly and allows duplicate names', async () => {
    const service = isolatedService();
    await select(service);

    expect(await join(service, { customerName: '  ALi  ' })).toEqual({
      kind: 'success',
      privateStatusToken: 'token-1'
    });
    expect(
      await join(service, { customerName: '  ALi  ', phone: '555-9999' })
    ).toEqual({ kind: 'success', privateStatusToken: 'token-2' });
    expect(service.getSnapshotForTesting().entries.map((entry) => entry.customerName)).toEqual([
      '  ALi  ',
      '  ALi  '
    ]);
  });

  ['', ' ', '\t\r\n'].forEach((customerName) => {
    it(`rejects blank customer name ${JSON.stringify(customerName)}`, async () => {
      const tokenGenerator = jasmine.createSpy().and.returnValue('unused');
      const service = isolatedService({ privateTokenGenerator: tokenGenerator });
      await select(service);

      expect(await join(service, { customerName })).toEqual(
        jasmine.objectContaining({ kind: 'validation' })
      );
      expect(tokenGenerator).not.toHaveBeenCalled();
      expect(service.getSnapshotForTesting().entries).toEqual([]);
    });
  });

  [
    ['5551234', 'digits'],
    ['555 12-34', 'spaces and hyphens'],
    ['(555) 1234', 'parentheses'],
    ['+15551234', 'one leading plus']
  ].forEach(([phone, description]) => {
    it(`accepts a phone with ${description}`, async () => {
      const service = isolatedService();
      await select(service);

      expect(await join(service, { phone })).toEqual({
        kind: 'success',
        privateStatusToken: 'token-1'
      });
      expect(service.getSnapshotForTesting().entries[0].phone).toBe(phone);
    });
  });

  [
    ['', 'empty'],
    ['- ( ) ', 'formatting only'],
    ['555CALL', 'letters'],
    ['555.1234', 'other punctuation'],
    ['+', 'bare plus'],
    ['55+51234', 'embedded plus'],
    ['++15551234', 'repeated plus']
  ].forEach(([phone, description]) => {
    it(`rejects a phone containing ${description}`, async () => {
      const tokenGenerator = jasmine.createSpy().and.returnValue('unused');
      const service = isolatedService({ privateTokenGenerator: tokenGenerator });
      await select(service);

      expect(await join(service, { phone })).toEqual(
        jasmine.objectContaining({ kind: 'validation' })
      );
      expect(tokenGenerator).not.toHaveBeenCalled();
      expect(service.getSnapshotForTesting().entries).toEqual([]);
    });
  });

  [1, 30].forEach((partySize) => {
    it(`accepts boundary party size ${partySize}`, async () => {
      const service = isolatedService();
      await select(service);

      expect(await join(service, { partySize })).toEqual({
        kind: 'success',
        privateStatusToken: 'token-1'
      });
    });
  });

  [0, -1, 31, 1.5, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY].forEach(
    (partySize) => {
      it(`rejects invalid party size ${partySize}`, async () => {
        const tokenGenerator = jasmine.createSpy().and.returnValue('unused');
        const service = isolatedService({ privateTokenGenerator: tokenGenerator });
        await select(service);

        expect(await join(service, { partySize })).toEqual(
          jasmine.objectContaining({ kind: 'validation' })
        );
        expect(tokenGenerator).not.toHaveBeenCalled();
        expect(service.getSnapshotForTesting().entries).toEqual([]);
      });
    }
  );

  it('validates before token generation and retains selection and existing FIFO state', async () => {
    const tokenGenerator = jasmine.createSpy().and.returnValues('token-1', 'token-2');
    const service = isolatedService({ privateTokenGenerator: tokenGenerator });
    await select(service);

    await join(service);
    expect(await join(service, { customerName: ' ', phone: 'new', partySize: 0 })).toEqual(
      jasmine.objectContaining({ kind: 'validation' })
    );
    expect(tokenGenerator).toHaveBeenCalledTimes(1);
    expect(await join(service, { phone: '555-9999' })).toEqual({
      kind: 'success',
      privateStatusToken: 'token-2'
    });
    expect(service.getSnapshotForTesting().entries.map((entry) => entry.insertionOrder)).toEqual([
      1, 2
    ]);
  });

  it('stores all shared-state fields and appends successful subscriptions in strict FIFO order', async () => {
    const service = isolatedService();
    await select(service);

    const second$ = service.joinWaitlist({
      customerName: 'Second',
      phone: '+1 (555) 222-3333',
      partySize: 30
    });
    const first$ = service.joinWaitlist({
      customerName: 'First',
      phone: '555-1111',
      partySize: 1
    });
    await firstValueFrom(first$);
    await firstValueFrom(second$);

    expect(service.getSnapshotForTesting().entries).toEqual([
      {
        restaurantSlug: 'first',
        restaurantName: 'First Restaurant',
        customerName: 'First',
        phone: '555-1111',
        comparisonPhone: '5551111',
        partySize: 1,
        status: 'active',
        insertionOrder: 1,
        privateStatusToken: 'token-1'
      },
      {
        restaurantSlug: 'first',
        restaurantName: 'First Restaurant',
        customerName: 'Second',
        phone: '+1 (555) 222-3333',
        comparisonPhone: '+15552223333',
        partySize: 30,
        status: 'active',
        insertionOrder: 2,
        privateStatusToken: 'token-2'
      }
    ]);
  });

  it('returns globally unique opaque tokens without exposing an entry id or URL', async () => {
    const service = MockCustomerWaitlistService.createForTesting({
      restaurants: [
        { slug: 'first', restaurantName: 'First Restaurant' },
        { slug: 'second', restaurantName: 'Second Restaurant' }
      ]
    });
    await select(service, 'first');
    const first = await join(service);
    await select(service, 'second');
    const second = await join(service, { phone: '555-9999' });

    expect(first.kind).toBe('success');
    expect(second.kind).toBe('success');
    if (first.kind === 'success' && second.kind === 'success') {
      expect(first.privateStatusToken).toMatch(/^[0-9a-f-]{36}$/i);
      expect(second.privateStatusToken).not.toBe(first.privateStatusToken);
      expect(Object.keys(first)).toEqual(['kind', 'privateStatusToken']);
      expect(first.privateStatusToken).not.toContain('first');
      expect(first.privateStatusToken).not.toContain('555');
    }
  });

  it('rejects a formatting-only duplicate without generating or revealing a token', async () => {
    const tokenGenerator = jasmine.createSpy().and.returnValues('private-one', 'must-not-run');
    const service = isolatedService({ privateTokenGenerator: tokenGenerator });
    await select(service);
    await join(service, { phone: '(555) 123-4567' });

    const result = await join(service, { phone: '555123 4567' });

    expect(result).toEqual({
      kind: 'duplicate-phone',
      message: DUPLICATE_PHONE_MESSAGE
    });
    expect(JSON.stringify(result)).not.toContain('private-one');
    expect(tokenGenerator).toHaveBeenCalledTimes(1);
    expect(service.getSnapshotForTesting().entries.length).toBe(1);
  });

  it('scopes active-phone uniqueness by restaurant', async () => {
    const service = isolatedService({
      restaurants: [
        { slug: 'first', restaurantName: 'First Restaurant' },
        { slug: 'second', restaurantName: 'Second Restaurant' }
      ]
    });
    await select(service, 'first');
    expect(await join(service)).toEqual({ kind: 'success', privateStatusToken: 'token-1' });
    await select(service, 'second');
    expect(await join(service)).toEqual({ kind: 'success', privateStatusToken: 'token-2' });
  });

  it('keeps leading-plus and unprefixed phones distinct in one restaurant', async () => {
    const service = isolatedService();
    await select(service);

    expect(await join(service, { phone: '+15551234' })).toEqual({
      kind: 'success',
      privateStatusToken: 'token-1'
    });
    expect(await join(service, { phone: '15551234' })).toEqual({
      kind: 'success',
      privateStatusToken: 'token-2'
    });
  });

  [
    { description: 'empty', generator: () => '' },
    { description: 'colliding', generator: () => 'token-1' },
    {
      description: 'throwing',
      generator: () => {
        throw new Error('sensitive token detail');
      }
    }
  ].forEach(({ description, generator }) => {
    it(`turns a ${description} token into an unexpected result without a partial commit`, async () => {
      const tokenGenerator = jasmine.createSpy().and.returnValues('token-1').and.callFake(generator);
      if (description !== 'colliding') {
        tokenGenerator.and.callFake(generator);
      }
      const service = isolatedService({ privateTokenGenerator: tokenGenerator });
      await select(service);

      if (description === 'colliding') {
        tokenGenerator.and.returnValue('token-1');
        expect(await join(service)).toEqual({ kind: 'success', privateStatusToken: 'token-1' });
      }
      const before = service.getSnapshotForTesting().entries;

      expect(await join(service, { phone: '555-9999' })).toEqual({
        kind: 'unexpected',
        message: UNEXPECTED_ERROR_MESSAGE
      });
      expect(service.getSnapshotForTesting().entries).toEqual(before);
    });
  });

  it('converts lookup faults, clears selection, and makes no partial state change', async () => {
    const service = isolatedService({
      beforeLookup: (slug) => {
        if (slug === 'fault') {
          throw new Error('sensitive lookup detail');
        }
      }
    });
    await select(service);

    expect(await select(service, 'fault')).toEqual({
      kind: 'unexpected',
      message: UNEXPECTED_ERROR_MESSAGE
    });
    expect(await join(service)).toEqual({ kind: 'not-found' });
    expect(service.getSnapshotForTesting().entries).toEqual([]);
  });
});
