import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { sign } from 'cookie-signature';
import request = require('supertest');

import { configureApplication } from './application-configuration';
import { AppModule } from './app.module';
import { SystemClock } from './demo-data-seeder';
import {
  ActiveWaitlistEntryRecord,
  FinalWaitlistStatus,
  InMemoryStore,
} from './in-memory-store';

const seedTime = new Date(2026, 8, 12, 21, 0, 0);
const cancellationTime = new Date(2026, 8, 12, 21, 5, 0);
const morganToken = '8f4d6e2b-1a73-4c95-b0e8-62d9f71a3c44';
const alexToken = 'c2a7198e-6d40-4b53-9f81-37e5a6c04bd2';
const morganAction = '9c777a3d-b7ed-4c86-95ce-7f456a62ff11';
const unexpectedBody = {
  kind: 'unexpected',
  message: 'Something went wrong. Please try again.',
};

interface TestContext {
  app: INestApplication;
  store: InMemoryStore;
  clock: { now: jest.Mock<Date, []> };
}

async function createTestContext(): Promise<TestContext> {
  const clock = { now: jest.fn(() => new Date(seedTime)) };
  const module = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(SystemClock)
    .useValue(clock)
    .compile();
  const app = module.createNestApplication();
  configureApplication(app, {
    port: 8000,
    secretKey: 'cancellation-test-secret',
    frontendOrigin: 'http://localhost:4200',
  });
  await app.init();
  clock.now.mockClear();
  clock.now.mockImplementation(() => new Date(cancellationTime));
  return { app, store: module.get(InMemoryStore), clock };
}

function createRestaurant(store: InMemoryStore, suffix: string) {
  return store.createRestaurant({
    name: `Restaurant ${suffix}`,
    normalizedName: `restaurant ${suffix}`,
    email: `${suffix}@example.com`,
    normalizedEmail: `${suffix}@example.com`,
    passwordHash: `hash-${suffix}`,
    slug: `restaurant-${suffix}`,
    verified: true,
    createdAt: seedTime,
  });
}

function createEntry(
  store: InMemoryStore,
  restaurantId: number,
  token: string,
  phone: string,
  status: 'active' | FinalWaitlistStatus = 'active',
) {
  const base = {
    restaurantId,
    customerName: `Customer ${token}`,
    phone,
    normalizedPhone: phone.replace(/[ \-()]/g, ''),
    partySize: 2,
    privateStatusToken: token,
    actionReference: `action-${token}`,
    joinedAt: seedTime,
  };
  return status === 'active'
    ? store.createWaitlistEntry({ ...base, status })
    : store.createWaitlistEntry({
        ...base,
        status,
        resolvedAt: new Date(seedTime.getTime() + 1_000),
      });
}

function expectNeutralHeaders(response: request.Response): void {
  expect(response.headers['cache-control']).toBeUndefined();
  expect(response.headers['set-cookie']).toBeUndefined();
  expect(response.headers.location).toBeUndefined();
  expect(response.headers['www-authenticate']).toBeUndefined();
}

describe('POST /api/waitlist-entries/:privateToken/cancellations', () => {
  it('atomically cancels the seeded entry with one clock value and retains all other data', async () => {
    const context = await createTestContext();
    const before = context.store.findWaitlistEntryById(1);
    const response = await request(context.app.getHttpServer())
      .post(`/api/waitlist-entries/${morganToken}/cancellations`)
      .expect(200, { kind: 'cancelled' });

    expect(response.headers['content-type']).toMatch(/^application\/json/);
    expect(Object.keys(response.body)).toEqual(['kind']);
    expectNeutralHeaders(response);
    expect(context.clock.now).toHaveBeenCalledTimes(1);
    expect(context.store.findWaitlistEntryById(1)).toEqual({
      ...before,
      status: 'cancelled',
      resolvedAt: cancellationTime,
    });
    await context.app.close();
  });

  it('is immediately visible as resolved and advances only the same restaurant queue', async () => {
    const context = await createTestContext();
    const other = createRestaurant(context.store, 'other');
    createEntry(context.store, other.id, 'other-one', '111');

    await request(context.app.getHttpServer())
      .post(`/api/waitlist-entries/${morganToken}/cancellations`)
      .expect(200);
    await request(context.app.getHttpServer())
      .get(`/api/waitlist-entries/${morganToken}`)
      .expect(200, {
        kind: 'resolved',
        restaurantName: 'Demo Restaurant',
        finalStatus: 'cancelled',
      });
    await request(context.app.getHttpServer())
      .get('/api/waitlist-entries/7a2bfe87-27d4-4e13-8b0d-e7804c1e7421')
      .expect(200, {
        kind: 'active',
        restaurantName: 'Demo Restaurant',
        position: 1,
      });
    await request(context.app.getHttpServer())
      .get('/api/waitlist-entries/other-one')
      .expect(200, {
        kind: 'active',
        restaurantName: 'Restaurant other',
        position: 1,
      });
    await context.app.close();
  });

  it('preserves insertion FIFO despite timestamp and party-size values', async () => {
    const context = await createTestContext();
    context.store.createWaitlistEntry({
      restaurantId: 1,
      customerName: 'Later one',
      phone: '111',
      normalizedPhone: '111',
      partySize: 30,
      privateStatusToken: 'later-one',
      actionReference: 'later-one-action',
      joinedAt: new Date(seedTime.getTime() + 60_000),
      status: 'active',
    });
    context.store.createWaitlistEntry({
      restaurantId: 1,
      customerName: 'Later two',
      phone: '222',
      normalizedPhone: '222',
      partySize: 1,
      privateStatusToken: 'later-two',
      actionReference: 'later-two-action',
      joinedAt: new Date(seedTime.getTime() - 60_000),
      status: 'active',
    });
    context.store.resolveWaitlistEntry(2, 'seated', seedTime);

    await request(context.app.getHttpServer())
      .post(`/api/waitlist-entries/${morganToken}/cancellations`)
      .expect(200);
    await request(context.app.getHttpServer())
      .get('/api/waitlist-entries/later-one')
      .expect(200, {
        kind: 'active',
        restaurantName: 'Demo Restaurant',
        position: 1,
      });
    await request(context.app.getHttpServer())
      .get('/api/waitlist-entries/later-two')
      .expect(200, {
        kind: 'active',
        restaurantName: 'Demo Restaurant',
        position: 2,
      });
    await context.app.close();
  });

  it('rejects a physically removed token without reading the clock', async () => {
    const context = await createTestContext();
    const entry = createEntry(context.store, 1, 'removed-token', '111');
    expect(context.store.removeWaitlistEntry(entry.id)).toBe(true);

    const response = await request(context.app.getHttpServer())
      .post('/api/waitlist-entries/removed-token/cancellations')
      .expect(404, { kind: 'not-found' });
    expect(context.clock.now).not.toHaveBeenCalled();
    expectNeutralHeaders(response);
    await context.app.close();
  });

  it('frees only the cancelled restaurant phone for a new FIFO join with fresh capabilities', async () => {
    const context = await createTestContext();
    const old = context.store.findWaitlistEntryById(1);
    const other = createRestaurant(context.store, 'phone-owner');
    createEntry(context.store, other.id, 'other-same-phone', '(555) 010-1000');

    await request(context.app.getHttpServer())
      .post(`/api/waitlist-entries/${morganToken}/cancellations`)
      .expect(200);
    const join = await request(context.app.getHttpServer())
      .post('/api/restaurants/demo-restaurant/waitlist-entries')
      .send({
        customerName: 'Morgan Again',
        phone: '5550101000',
        partySize: 1,
      })
      .expect(201);

    const replacement = context.store.findWaitlistEntryByPrivateStatusToken(
      join.body.privateStatusToken,
    );
    expect(replacement).toMatchObject({
      id: 5,
      restaurantId: 1,
      normalizedPhone: '5550101000',
      status: 'active',
    });
    expect(replacement?.privateStatusToken).not.toBe(old?.privateStatusToken);
    expect(replacement?.actionReference).not.toBe(old?.actionReference);
    expect(context.store.findWaitlistEntryById(1)).toMatchObject({
      privateStatusToken: old?.privateStatusToken,
      actionReference: old?.actionReference,
      status: 'cancelled',
    });
    await request(context.app.getHttpServer())
      .post(`/api/restaurants/${other.slug}/waitlist-entries`)
      .send({ customerName: 'Duplicate', phone: '5550101000', partySize: 1 })
      .expect(409);
    await context.app.close();
  });

  it.each([
    'unknown-token',
    morganToken.toUpperCase(),
    `%20${morganToken}%20`,
    'demo-restaurant',
    '1',
    morganAction,
  ])(
    'rejects exact-token mismatch %s without clock or mutation',
    async (token) => {
      const context = await createTestContext();
      const before = context.store.findWaitlistEntryById(1);
      const response = await request(context.app.getHttpServer())
        .post(`/api/waitlist-entries/${token}/cancellations`)
        .expect(404, { kind: 'not-found' });

      expect(context.clock.now).not.toHaveBeenCalled();
      expect(context.store.findWaitlistEntryById(1)).toEqual(before);
      expectNeutralHeaders(response);
      await context.app.close();
    },
  );

  it('uses exactly the framework single-decoded token', async () => {
    const context = await createTestContext();
    createEntry(context.store, 1, '%61', '111');
    await request(context.app.getHttpServer())
      .post('/api/waitlist-entries/%2561/cancellations')
      .expect(200, { kind: 'cancelled' });
    await request(context.app.getHttpServer())
      .post('/api/waitlist-entries/%61/cancellations')
      .expect(404, { kind: 'not-found' });
    expect(context.clock.now).toHaveBeenCalledTimes(1);
    await context.app.close();
  });

  it.each(['seated', 'cancelled', 'no-show'] as const)(
    'rejects an already %s entry without changing its resolution',
    async (status) => {
      const context = await createTestContext();
      const entry =
        status === 'seated'
          ? context.store.findWaitlistEntryByPrivateStatusToken(alexToken)
          : createEntry(context.store, 1, `already-${status}`, '111', status);
      const response = await request(context.app.getHttpServer())
        .post(
          `/api/waitlist-entries/${entry?.privateStatusToken}/cancellations`,
        )
        .expect(404, { kind: 'not-found' });

      expect(context.clock.now).not.toHaveBeenCalled();
      expect(context.store.findWaitlistEntryById(entry?.id ?? 0)).toEqual(
        entry,
      );
      expectNeutralHeaders(response);
      await context.app.close();
    },
  );

  it('is non-idempotent at the HTTP result while preserving the first resolution', async () => {
    const context = await createTestContext();
    await request(context.app.getHttpServer())
      .post(`/api/waitlist-entries/${morganToken}/cancellations`)
      .expect(200, { kind: 'cancelled' });
    const resolved = context.store.findWaitlistEntryById(1);
    await request(context.app.getHttpServer())
      .post(`/api/waitlist-entries/${morganToken}/cancellations`)
      .expect(404, { kind: 'not-found' });
    expect(context.clock.now).toHaveBeenCalledTimes(1);
    expect(context.store.findWaitlistEntryById(1)).toEqual(resolved);
    await context.app.close();
  });

  it('rejects an orphaned active entry without changing it or reading the clock', async () => {
    const context = await createTestContext();
    const orphan = createEntry(context.store, 999, 'orphan-token', '111');
    await request(context.app.getHttpServer())
      .post('/api/waitlist-entries/orphan-token/cancellations')
      .expect(404, { kind: 'not-found' });
    expect(context.clock.now).not.toHaveBeenCalled();
    expect(context.store.findWaitlistEntryById(orphan.id)).toEqual(orphan);
    await context.app.close();
  });

  it('allows exactly one of two concurrent cancellations', async () => {
    const context = await createTestContext();
    const responses = await Promise.all([
      request(context.app.getHttpServer()).post(
        `/api/waitlist-entries/${morganToken}/cancellations`,
      ),
      request(context.app.getHttpServer()).post(
        `/api/waitlist-entries/${morganToken}/cancellations`,
      ),
    ]);

    expect(responses.map((response) => response.status).sort()).toEqual([
      200, 404,
    ]);
    expect(context.clock.now).toHaveBeenCalledTimes(1);
    expect(context.store.findWaitlistEntryById(1)).toMatchObject({
      status: 'cancelled',
      resolvedAt: cancellationTime,
    });
    await context.app.close();
  });

  it('isolates concurrent cancellations for different tokens and retains capabilities', async () => {
    const context = await createTestContext();
    const second = createEntry(context.store, 1, 'second-active', '111');
    const beforeOne = context.store.findWaitlistEntryById(1);
    const beforeSecond = context.store.findWaitlistEntryById(second.id);

    const responses = await Promise.all([
      request(context.app.getHttpServer()).post(
        `/api/waitlist-entries/${morganToken}/cancellations`,
      ),
      request(context.app.getHttpServer()).post(
        '/api/waitlist-entries/second-active/cancellations',
      ),
    ]);

    expect(responses.map((response) => response.status)).toEqual([200, 200]);
    expect(context.clock.now).toHaveBeenCalledTimes(2);
    expect(context.store.findWaitlistEntryById(1)).toMatchObject({
      privateStatusToken: beforeOne?.privateStatusToken,
      actionReference: beforeOne?.actionReference,
      status: 'cancelled',
    });
    expect(context.store.findWaitlistEntryById(second.id)).toMatchObject({
      privateStatusToken: beforeSecond?.privateStatusToken,
      actionReference: beforeSecond?.actionReference,
      status: 'cancelled',
    });
    expect(
      context.store.listActiveWaitlistEntries(1).map((entry) => entry.id),
    ).toEqual([2]);
    await context.app.close();
  });

  it.each(['clock', 'store'])(
    'rolls back a %s failure with exact sanitized response and unchanged state',
    async (failure) => {
      const context = await createTestContext();
      const before = context.store.findWaitlistEntryById(1);
      const logs = [
        jest.spyOn(console, 'log').mockImplementation(() => undefined),
        jest.spyOn(console, 'warn').mockImplementation(() => undefined),
        jest.spyOn(console, 'error').mockImplementation(() => undefined),
      ];
      if (failure === 'clock') {
        context.clock.now.mockImplementationOnce(() => {
          throw new Error(`private clock ${morganToken}`);
        });
      } else {
        const internals = context.store as unknown as {
          waitlistEntries: Map<number, ActiveWaitlistEntryRecord>;
        };
        const originalSet = internals.waitlistEntries.set.bind(
          internals.waitlistEntries,
        );
        jest
          .spyOn(internals.waitlistEntries, 'set')
          .mockImplementationOnce((id, entry) => {
            originalSet(id, entry);
            throw new Error(`private store ${morganToken}`);
          });
      }

      const response = await request(context.app.getHttpServer())
        .post(`/api/waitlist-entries/${morganToken}/cancellations`)
        .expect(500, unexpectedBody);

      expect(response.headers['content-type']).toMatch(/^application\/json/);
      expect(JSON.stringify(response.body)).not.toMatch(
        /private|clock|store|8f4d6e2b|Morgan|555|9c777a3d|stack/i,
      );
      expectNeutralHeaders(response);
      expect(context.store.findWaitlistEntryById(1)).toEqual(before);
      expect(
        context.store.listActiveWaitlistEntries(1).map((entry) => entry.id),
      ).toEqual([1, 2]);
      expect(context.clock.now).toHaveBeenCalledTimes(1);
      expect(logs.every((log) => log.mock.calls.length === 0)).toBe(true);
      logs.forEach((log) => log.mockRestore());
      await context.app.close();
    },
  );

  it.each([
    ['missing', undefined],
    [
      'valid',
      `restaurant_session=${encodeURIComponent(
        `s:${sign('demo-restaurant', 'cancellation-test-secret')}`,
      )}`,
    ],
    ['unsigned', 'restaurant_session=demo-restaurant'],
    ['tampered', 'restaurant_session=s%3Atampered'],
    [
      'wrong-secret',
      `restaurant_session=${encodeURIComponent(
        `s:${sign('demo-restaurant', 'wrong-secret')}`,
      )}`,
    ],
    [
      'unknown restaurant',
      `restaurant_session=${encodeURIComponent(
        `s:${sign('unknown', 'cancellation-test-secret')}`,
      )}`,
    ],
  ])('ignores the %s restaurant session', async (_case, cookie) => {
    const context = await createTestContext();
    const call = request(context.app.getHttpServer()).post(
      `/api/waitlist-entries/${morganToken}/cancellations`,
    );
    if (cookie !== undefined) {
      call.set('Cookie', cookie);
    }
    const response = await call.expect(200, { kind: 'cancelled' });
    expectNeutralHeaders(response);
    await context.app.close();
  });

  it('ignores a signed session belonging to an unverified restaurant', async () => {
    const context = await createTestContext();
    const restaurant = createRestaurant(context.store, 'unverified');
    context.store.updateRestaurant(restaurant.id, { verified: false });
    const cookie = `restaurant_session=${encodeURIComponent(
      `s:${sign(restaurant.slug, 'cancellation-test-secret')}`,
    )}`;
    const response = await request(context.app.getHttpServer())
      .post(`/api/waitlist-entries/${morganToken}/cancellations`)
      .set('Cookie', cookie)
      .expect(200, { kind: 'cancelled' });
    expectNeutralHeaders(response);
    await context.app.close();
  });

  it('never exposes or logs private request, entry, account, or queue data', async () => {
    const context = await createTestContext();
    const logs = [
      jest.spyOn(console, 'log').mockImplementation(() => undefined),
      jest.spyOn(console, 'warn').mockImplementation(() => undefined),
      jest.spyOn(console, 'error').mockImplementation(() => undefined),
    ];

    const success = await request(context.app.getHttpServer())
      .post(`/api/waitlist-entries/${morganToken}/cancellations`)
      .expect(200);
    const missing = await request(context.app.getHttpServer())
      .post('/api/waitlist-entries/private-missing/cancellations')
      .expect(404);

    expect(JSON.stringify([success.body, missing.body])).not.toMatch(
      /8f4d6e2b|Morgan|555|Demo|position|party|reference|joined|resolved|restaurant|entry|phone|token/i,
    );
    expect(logs.every((log) => log.mock.calls.length === 0)).toBe(true);
    logs.forEach((log) => log.mockRestore());
    await context.app.close();
  });
});

describe('atomic private-token cancellation store operation', () => {
  function createStore(): {
    store: InMemoryStore;
    restaurantId: number;
    entry: ActiveWaitlistEntryRecord;
  } {
    const store = new InMemoryStore();
    const restaurant = createRestaurant(store, 'atomic');
    const entry = createEntry(store, restaurant.id, 'atomic-token', '111');
    if (entry.status !== 'active') {
      throw new Error('Expected active test fixture.');
    }
    return { store, restaurantId: restaurant.id, entry };
  }

  it('checks active ownership before invoking the clock and commits one timestamp', () => {
    const { store, entry } = createStore();
    const now = jest.fn(() => new Date(cancellationTime));

    expect(store.cancelWaitlistEntry('atomic-token', now)).toMatchObject({
      kind: 'cancelled',
      entry: {
        id: entry.id,
        status: 'cancelled',
        resolvedAt: cancellationTime,
      },
    });
    expect(now).toHaveBeenCalledTimes(1);
    expect(store.cancelWaitlistEntry('atomic-token', now)).toEqual({
      kind: 'not-found',
    });
    expect(now).toHaveBeenCalledTimes(1);
  });

  it('serializes cancel-before-join and join-before-cancel without two active phones', async () => {
    for (const cancellationFirst of [true, false]) {
      const { store, restaurantId } = createStore();
      const cancel = () =>
        store.cancelWaitlistEntry('atomic-token', () => cancellationTime);
      const join = () =>
        store.commitWaitlistJoin('restaurant-atomic', {
          customerName: 'Replacement',
          phone: '111',
          normalizedPhone: '111',
          partySize: 1,
          privateStatusToken: `private-${String(cancellationFirst)}`,
          actionReference: `action-${String(cancellationFirst)}`,
          joinedAt: cancellationTime,
        });
      const results = cancellationFirst
        ? await Promise.all([
            Promise.resolve().then(cancel),
            Promise.resolve().then(join),
          ])
        : await Promise.all([
            Promise.resolve().then(join),
            Promise.resolve().then(cancel),
          ]);

      expect(results.map((result) => result.kind)).toEqual(
        cancellationFirst
          ? ['cancelled', 'created']
          : ['duplicate-phone', 'cancelled'],
      );
      expect(
        store
          .listActiveWaitlistEntries(restaurantId)
          .filter((entry) => entry.normalizedPhone === '111'),
      ).toHaveLength(cancellationFirst ? 1 : 0);
    }
  });
});
