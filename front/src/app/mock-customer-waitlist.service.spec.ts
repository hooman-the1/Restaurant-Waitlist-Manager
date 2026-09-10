import { fakeAsync, flushMicrotasks, TestBed } from '@angular/core/testing';
import { firstValueFrom } from 'rxjs';

import { appConfig } from './app.config';
import {
  DUPLICATE_PHONE_MESSAGE,
  JoinWaitlistInput,
  UNEXPECTED_ERROR_MESSAGE
} from './api-contracts';
import {
  MockCustomerWaitlistService,
  MockCustomerWaitlistTestOptions
} from './mock-customer-waitlist.service';
import { CUSTOMER_WAITLIST_SERVICE } from './service-boundary';

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
