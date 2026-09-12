import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { sign } from 'cookie-signature';
import { NextFunction, Request, Response } from 'express';
import request = require('supertest');

import { configureApplication } from './application-configuration';
import { AppModule } from './app.module';
import { SystemClock } from './demo-data-seeder';
import {
  ActiveWaitlistEntryRecord,
  FinalWaitlistStatus,
  InMemoryStore,
} from './in-memory-store';
import { RestaurantSessionGuard } from './restaurant-session';

const secret = 'staff-resolution-test-secret';
const seedTime = new Date(2026, 8, 12, 12, 0, 0);
const resolutionTime = new Date(2026, 8, 12, 12, 5, 0);
const morganToken = '8f4d6e2b-1a73-4c95-b0e8-62d9f71a3c44';
const morganAction = '9c777a3d-b7ed-4c86-95ce-7f456a62ff11';
const unexpectedBody = {
  kind: 'unexpected',
  message: 'Something went wrong. Please try again.',
};

interface TestContext {
  app: INestApplication;
  store: InMemoryStore;
  clock: { now: jest.Mock<Date, []> };
  sessionGuard: RestaurantSessionGuard;
}

async function createTestContext(options?: {
  signedCookieValue?: unknown;
}): Promise<TestContext> {
  const clock = { now: jest.fn(() => new Date(seedTime)) };
  const module = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(SystemClock)
    .useValue(clock)
    .compile();
  const app = module.createNestApplication();
  configureApplication(app, {
    port: 8000,
    secretKey: secret,
    frontendOrigin: 'http://localhost:4200',
  });
  if (options !== undefined && 'signedCookieValue' in options) {
    app.use((incoming: Request, _response: Response, next: NextFunction) => {
      (
        incoming as unknown as { signedCookies: Record<string, unknown> }
      ).signedCookies = { restaurant_session: options.signedCookieValue };
      next();
    });
  }
  await app.init();
  clock.now.mockClear();
  clock.now.mockImplementation(() => new Date(resolutionTime));
  return {
    app,
    store: module.get(InMemoryStore),
    clock,
    sessionGuard: module.get(RestaurantSessionGuard),
  };
}

function sessionCookie(slug: string, signingSecret = secret): string {
  return `restaurant_session=${encodeURIComponent(
    `s:${sign(slug, signingSecret)}`,
  )}`;
}

function createRestaurant(
  store: InMemoryStore,
  suffix: string,
  verified = true,
) {
  return store.createRestaurant({
    name: `Restaurant ${suffix}`,
    normalizedName: `restaurant ${suffix}`,
    email: `${suffix}@example.com`,
    normalizedEmail: `${suffix}@example.com`,
    passwordHash: `hash-${suffix}`,
    slug: `restaurant-${suffix}`,
    verified,
    createdAt: seedTime,
  });
}

function createEntry(
  store: InMemoryStore,
  restaurantId: number,
  suffix: string,
  status: 'active' | FinalWaitlistStatus = 'active',
) {
  const base = {
    restaurantId,
    customerName: `Customer ${suffix}`,
    phone: `555-010-${suffix.length.toString().padStart(4, '0')}`,
    normalizedPhone: `555010${suffix.length.toString().padStart(4, '0')}`,
    partySize: 2,
    privateStatusToken: `private-${suffix}`,
    actionReference: `action-${suffix}`,
    joinedAt: seedTime,
  };
  return status === 'active'
    ? store.createWaitlistEntry({ ...base, status })
    : store.createWaitlistEntry({
        ...base,
        status,
        resolvedAt: seedTime,
      });
}

function expectNeutralHeaders(response: request.Response): void {
  expect(response.headers['cache-control']).toBeUndefined();
  expect(response.headers['set-cookie']).toBeUndefined();
  expect(response.headers.location).toBeUndefined();
  expect(response.headers['www-authenticate']).toBeUndefined();
}

describe('PATCH /api/dashboard/waitlist-entries/:actionReference', () => {
  it('resolves the seeded entry exactly and retains every non-resolution field', async () => {
    const context = await createTestContext();
    const before = context.store.findWaitlistEntryById(1);
    const response = await request(context.app.getHttpServer())
      .patch(`/api/dashboard/waitlist-entries/${morganAction}`)
      .set('Cookie', sessionCookie('demo-restaurant'))
      .send({ resolution: 'seated' })
      .expect(200, { kind: 'success' });

    expect(response.headers['content-type']).toMatch(/^application\/json/);
    expect(Object.keys(response.body)).toEqual(['kind']);
    expectNeutralHeaders(response);
    expect(context.clock.now).toHaveBeenCalledTimes(1);
    expect(context.store.findWaitlistEntryById(1)).toEqual({
      ...before,
      status: 'seated',
      resolvedAt: resolutionTime,
    });
    await context.app.close();
  });

  it.each(['seated', 'cancelled', 'no-show'] as const)(
    'commits the exact %s status',
    async (status) => {
      const context = await createTestContext();
      const entry = createEntry(context.store, 1, `status-${status}`);
      await request(context.app.getHttpServer())
        .patch(`/api/dashboard/waitlist-entries/${entry.actionReference}`)
        .set('Cookie', sessionCookie('demo-restaurant'))
        .send({ resolution: status })
        .expect(200, { kind: 'success' });
      expect(context.store.findWaitlistEntryById(entry.id)).toMatchObject({
        status,
        resolvedAt: resolutionTime,
      });
      await context.app.close();
    },
  );

  it.each([
    ['missing body', undefined],
    ['null body', null],
    ['array body', []],
    ['string body', 'seated'],
    ['number body', 1],
    ['boolean body', true],
    ['missing property', {}],
    ['extra property', { resolution: 'seated', extra: true }],
    ['null', { resolution: null }],
    ['array', { resolution: [] }],
    ['object', { resolution: {} }],
    ['number', { resolution: 1 }],
    ['boolean', { resolution: true }],
    ['empty', { resolution: '' }],
    ['case variant', { resolution: 'Seated' }],
    ['whitespace variant', { resolution: ' seated ' }],
    ['unknown', { resolution: 'waiting' }],
  ])(
    'rejects %s with exact validation response before action work',
    async (_case, body) => {
      const context = await createTestContext();
      const before = context.store.findWaitlistEntryById(1);
      const call = request(context.app.getHttpServer())
        .patch(`/api/dashboard/waitlist-entries/${morganAction}`)
        .set('Cookie', sessionCookie('demo-restaurant'));
      if (
        body === null ||
        typeof body === 'string' ||
        typeof body === 'number' ||
        typeof body === 'boolean'
      ) {
        call.set('Content-Type', 'application/json').send(JSON.stringify(body));
      } else if (body !== undefined) {
        call.send(body);
      }
      const response = await call.expect(400, {
        kind: 'validation',
        message: 'Invalid request.',
      });
      expect(context.clock.now).not.toHaveBeenCalled();
      expect(context.store.findWaitlistEntryById(1)).toEqual(before);
      expectNeutralHeaders(response);
      await context.app.close();
    },
  );

  it('rejects malformed JSON before authentication and transition work', async () => {
    const context = await createTestContext();
    const before = context.store.findWaitlistEntryById(1);
    const transition = jest.spyOn(
      context.store,
      'resolveWaitlistEntryByActionReference',
    );
    const response = await request(context.app.getHttpServer())
      .patch(`/api/dashboard/waitlist-entries/${morganAction}`)
      .set('Content-Type', 'application/json')
      .send('{"resolution":')
      .expect(400, { kind: 'validation', message: 'Invalid request.' });
    expect(context.clock.now).not.toHaveBeenCalled();
    expect(transition).not.toHaveBeenCalled();
    expect(context.store.findWaitlistEntryById(1)).toEqual(before);
    expectNeutralHeaders(response);
    await context.app.close();
  });

  it.each([
    ['missing', undefined],
    ['unsigned', 'restaurant_session=demo-restaurant'],
    ['tampered', 'restaurant_session=s%3Atampered'],
    ['wrong-secret', sessionCookie('demo-restaurant', 'wrong-secret')],
    ['empty', sessionCookie('')],
    ['unknown restaurant', sessionCookie('unknown')],
  ])(
    'authenticates before DTO and action checks for %s session',
    async (_case, cookie) => {
      const context = await createTestContext();
      const transition = jest.spyOn(
        context.store,
        'resolveWaitlistEntryByActionReference',
      );
      const logs = [
        jest.spyOn(console, 'log').mockImplementation(() => undefined),
        jest.spyOn(console, 'warn').mockImplementation(() => undefined),
        jest.spyOn(console, 'error').mockImplementation(() => undefined),
      ];
      const call = request(context.app.getHttpServer()).patch(
        '/api/dashboard/waitlist-entries/unknown-action',
      );
      if (cookie !== undefined) {
        call.set('Cookie', cookie);
      }
      const response = await call.send({ resolution: 'INVALID' }).expect(401, {
        kind: 'unauthorized',
      });
      expect(context.clock.now).not.toHaveBeenCalled();
      expect(transition).not.toHaveBeenCalled();
      expect(logs.every((log) => log.mock.calls.length === 0)).toBe(true);
      logs.forEach((log) => log.mockRestore());
      expectNeutralHeaders(response);
      await context.app.close();
    },
  );

  it('rejects a non-string signed-cookie value before DTO/action work', async () => {
    const context = await createTestContext({ signedCookieValue: 42 });
    const response = await request(context.app.getHttpServer())
      .patch('/api/dashboard/waitlist-entries/unknown-action')
      .send({ resolution: 'INVALID' })
      .expect(401, { kind: 'unauthorized' });
    expect(context.clock.now).not.toHaveBeenCalled();
    expectNeutralHeaders(response);
    await context.app.close();
  });

  it('rejects an unverified restaurant before DTO/action work', async () => {
    const context = await createTestContext();
    const restaurant = createRestaurant(context.store, 'unverified', false);
    await request(context.app.getHttpServer())
      .patch('/api/dashboard/waitlist-entries/unknown-action')
      .set('Cookie', sessionCookie(restaurant.slug))
      .send({ resolution: 'INVALID' })
      .expect(401, { kind: 'unauthorized' });
    expect(context.clock.now).not.toHaveBeenCalled();
    await context.app.close();
  });

  it('sanitizes an unexpected authentication-guard failure without cache headers', async () => {
    const context = await createTestContext();
    jest
      .spyOn(context.sessionGuard, 'canActivate')
      .mockImplementationOnce(() => {
        throw new Error(`private guard ${morganAction}`);
      });
    const logs = [
      jest.spyOn(console, 'log').mockImplementation(() => undefined),
      jest.spyOn(console, 'warn').mockImplementation(() => undefined),
      jest.spyOn(console, 'error').mockImplementation(() => undefined),
    ];
    const response = await request(context.app.getHttpServer())
      .patch(`/api/dashboard/waitlist-entries/${morganAction}`)
      .set('Cookie', sessionCookie('demo-restaurant'))
      .send({ resolution: 'seated' })
      .expect(500, unexpectedBody);
    expect(context.clock.now).not.toHaveBeenCalled();
    expect(JSON.stringify(response.body)).not.toContain(morganAction);
    expect(logs.every((log) => log.mock.calls.length === 0)).toBe(true);
    logs.forEach((log) => log.mockRestore());
    expectNeutralHeaders(response);
    await context.app.close();
  });

  it.each([
    'unknown-action',
    morganAction.toUpperCase(),
    `%20${morganAction}%20`,
    morganToken,
    'demo-restaurant',
    '1',
  ])('returns not found for exact reference mismatch %s', async (reference) => {
    const context = await createTestContext();
    const before = context.store.findWaitlistEntryById(1);
    const response = await request(context.app.getHttpServer())
      .patch(`/api/dashboard/waitlist-entries/${reference}`)
      .set('Cookie', sessionCookie('demo-restaurant'))
      .send({ resolution: 'seated' })
      .expect(404, { kind: 'not-found' });
    expect(context.clock.now).not.toHaveBeenCalled();
    expect(context.store.findWaitlistEntryById(1)).toEqual(before);
    expectNeutralHeaders(response);
    await context.app.close();
  });

  it('uses exactly the framework single-decoded action reference', async () => {
    const context = await createTestContext();
    createEntry(context.store, 1, '%61');
    await request(context.app.getHttpServer())
      .patch('/api/dashboard/waitlist-entries/action-%2561')
      .set('Cookie', sessionCookie('demo-restaurant'))
      .send({ resolution: 'seated' })
      .expect(200);
    await request(context.app.getHttpServer())
      .patch('/api/dashboard/waitlist-entries/action-%61')
      .set('Cookie', sessionCookie('demo-restaurant'))
      .send({ resolution: 'seated' })
      .expect(404);
    expect(context.clock.now).toHaveBeenCalledTimes(1);
    await context.app.close();
  });

  it('does not disclose or mutate a foreign-owned action reference', async () => {
    const context = await createTestContext();
    const other = createRestaurant(context.store, 'foreign');
    const foreign = createEntry(context.store, other.id, 'foreign');
    await request(context.app.getHttpServer())
      .patch(`/api/dashboard/waitlist-entries/${foreign.actionReference}`)
      .set('Cookie', sessionCookie('demo-restaurant'))
      .send({ resolution: 'seated' })
      .expect(404, { kind: 'not-found' });
    expect(context.clock.now).not.toHaveBeenCalled();
    expect(context.store.findWaitlistEntryById(foreign.id)).toEqual(foreign);
    await context.app.close();
  });

  it.each(['seated', 'cancelled', 'no-show'] as const)(
    'cannot replace an already %s final status',
    async (status) => {
      const context = await createTestContext();
      const entry = createEntry(context.store, 1, `resolved-${status}`, status);
      await request(context.app.getHttpServer())
        .patch(`/api/dashboard/waitlist-entries/${entry.actionReference}`)
        .set('Cookie', sessionCookie('demo-restaurant'))
        .send({ resolution: status === 'seated' ? 'cancelled' : 'seated' })
        .expect(404, { kind: 'not-found' });
      expect(context.clock.now).not.toHaveBeenCalled();
      expect(context.store.findWaitlistEntryById(entry.id)).toEqual(entry);
      await context.app.close();
    },
  );

  it('rejects removed and orphaned references without reading the clock', async () => {
    const context = await createTestContext();
    const removed = createEntry(context.store, 1, 'removed');
    const orphan = createEntry(context.store, 999, 'orphan');
    context.store.removeWaitlistEntry(removed.id);
    for (const reference of [removed.actionReference, orphan.actionReference]) {
      await request(context.app.getHttpServer())
        .patch(`/api/dashboard/waitlist-entries/${reference}`)
        .set('Cookie', sessionCookie('demo-restaurant'))
        .send({ resolution: 'seated' })
        .expect(404, { kind: 'not-found' });
    }
    expect(context.clock.now).not.toHaveBeenCalled();
    expect(context.store.findWaitlistEntryById(orphan.id)).toEqual(orphan);
    await context.app.close();
  });

  it('is non-idempotent and preserves the first final status and timestamp', async () => {
    const context = await createTestContext();
    await request(context.app.getHttpServer())
      .patch(`/api/dashboard/waitlist-entries/${morganAction}`)
      .set('Cookie', sessionCookie('demo-restaurant'))
      .send({ resolution: 'no-show' })
      .expect(200);
    const resolved = context.store.findWaitlistEntryById(1);
    await request(context.app.getHttpServer())
      .patch(`/api/dashboard/waitlist-entries/${morganAction}`)
      .set('Cookie', sessionCookie('demo-restaurant'))
      .send({ resolution: 'cancelled' })
      .expect(404);
    expect(context.clock.now).toHaveBeenCalledTimes(1);
    expect(context.store.findWaitlistEntryById(1)).toEqual(resolved);
    await context.app.close();
  });

  it('updates dashboard, private status, and same-restaurant FIFO immediately', async () => {
    const context = await createTestContext();
    const other = createRestaurant(context.store, 'effects');
    createEntry(context.store, other.id, 'other-active');
    await request(context.app.getHttpServer())
      .patch(`/api/dashboard/waitlist-entries/${morganAction}`)
      .set('Cookie', sessionCookie('demo-restaurant'))
      .send({ resolution: 'cancelled' })
      .expect(200);

    const dashboard = await request(context.app.getHttpServer())
      .get('/api/dashboard')
      .set('Cookie', sessionCookie('demo-restaurant'))
      .expect(200);
    expect(dashboard.body.dashboard.activeEntries).toHaveLength(1);
    expect(dashboard.body.dashboard.activeEntries[0]).toMatchObject({
      position: 1,
      customerName: 'Sam Rivera',
    });
    expect(dashboard.body.dashboard.resolvedToday).toContainEqual({
      customerName: 'Morgan Lee',
      partySize: 6,
      finalStatus: 'cancelled',
    });
    await request(context.app.getHttpServer())
      .get(`/api/waitlist-entries/${morganToken}`)
      .expect(200, {
        kind: 'resolved',
        restaurantName: 'Demo Restaurant',
        finalStatus: 'cancelled',
      });
    expect(context.store.listActiveWaitlistEntries(other.id)).toHaveLength(1);
    await context.app.close();
  });

  it('frees only the owner phone for a new tail join with fresh capabilities', async () => {
    const context = await createTestContext();
    const before = context.store.findWaitlistEntryById(1);
    const other = createRestaurant(context.store, 'same-phone');
    context.store.createWaitlistEntry({
      restaurantId: other.id,
      customerName: 'Other phone owner',
      phone: '(555) 010-1000',
      normalizedPhone: '5550101000',
      partySize: 2,
      privateStatusToken: 'other-phone-private',
      actionReference: 'other-phone-action',
      joinedAt: seedTime,
      status: 'active',
    });
    await request(context.app.getHttpServer())
      .patch(`/api/dashboard/waitlist-entries/${morganAction}`)
      .set('Cookie', sessionCookie('demo-restaurant'))
      .send({ resolution: 'seated' })
      .expect(200);
    const join = await request(context.app.getHttpServer())
      .post('/api/restaurants/demo-restaurant/waitlist-entries')
      .send({ customerName: 'Morgan Again', phone: '5550101000', partySize: 1 })
      .expect(201);
    const replacement = context.store.findWaitlistEntryByPrivateStatusToken(
      join.body.privateStatusToken,
    );
    expect(replacement).toMatchObject({ id: 5, status: 'active' });
    expect(replacement?.privateStatusToken).not.toBe(
      before?.privateStatusToken,
    );
    expect(replacement?.actionReference).not.toBe(before?.actionReference);
    await request(context.app.getHttpServer())
      .post(`/api/restaurants/${other.slug}/waitlist-entries`)
      .send({ customerName: 'Duplicate', phone: '5550101000', partySize: 1 })
      .expect(409);
    await context.app.close();
  });

  it('serializes same-status and different-status concurrent requests', async () => {
    for (const statuses of [
      ['seated', 'seated'],
      ['cancelled', 'no-show'],
    ] as const) {
      const context = await createTestContext();
      const responses = await Promise.all(
        statuses.map((status) =>
          request(context.app.getHttpServer())
            .patch(`/api/dashboard/waitlist-entries/${morganAction}`)
            .set('Cookie', sessionCookie('demo-restaurant'))
            .send({ resolution: status }),
        ),
      );
      expect(responses.map((response) => response.status).sort()).toEqual([
        200, 404,
      ]);
      const winner = responses.findIndex((response) => response.status === 200);
      expect(context.store.findWaitlistEntryById(1)).toMatchObject({
        status: statuses[winner],
        resolvedAt: resolutionTime,
      });
      expect(context.clock.now).toHaveBeenCalledTimes(1);
      await context.app.close();
    }
  });

  it('serializes a staff-resolution/customer-cancellation race to one transition', async () => {
    const context = await createTestContext();
    const responses = await Promise.all([
      request(context.app.getHttpServer())
        .patch(`/api/dashboard/waitlist-entries/${morganAction}`)
        .set('Cookie', sessionCookie('demo-restaurant'))
        .send({ resolution: 'seated' }),
      request(context.app.getHttpServer()).post(
        `/api/waitlist-entries/${morganToken}/cancellations`,
      ),
    ]);
    expect(responses.map((response) => response.status).sort()).toEqual([
      200, 404,
    ]);
    expect(['seated', 'cancelled']).toContain(
      context.store.findWaitlistEntryById(1)?.status,
    );
    expect(context.store.findWaitlistEntryById(1)).toMatchObject({
      resolvedAt: resolutionTime,
    });
    expect(context.clock.now).toHaveBeenCalledTimes(1);
    await context.app.close();
  });

  it('isolates concurrent owned resolutions and a foreign request', async () => {
    const context = await createTestContext();
    const second = createEntry(context.store, 1, 'second-owned');
    const foreignRestaurant = createRestaurant(
      context.store,
      'foreign-concurrent',
    );
    const foreign = createEntry(
      context.store,
      foreignRestaurant.id,
      'foreign-concurrent',
    );
    const responses = await Promise.all([
      request(context.app.getHttpServer())
        .patch(`/api/dashboard/waitlist-entries/${morganAction}`)
        .set('Cookie', sessionCookie('demo-restaurant'))
        .send({ resolution: 'seated' }),
      request(context.app.getHttpServer())
        .patch(`/api/dashboard/waitlist-entries/${second.actionReference}`)
        .set('Cookie', sessionCookie('demo-restaurant'))
        .send({ resolution: 'no-show' }),
      request(context.app.getHttpServer())
        .patch(`/api/dashboard/waitlist-entries/${foreign.actionReference}`)
        .set('Cookie', sessionCookie('demo-restaurant'))
        .send({ resolution: 'cancelled' }),
    ]);
    expect(responses.map((response) => response.status)).toEqual([
      200, 200, 404,
    ]);
    expect(context.store.findWaitlistEntryById(foreign.id)).toEqual(foreign);
    expect(
      context.store.listActiveWaitlistEntries(1).map((entry) => entry.id),
    ).toEqual([2]);
    await context.app.close();
  });

  it.each(['clock', 'store'])(
    'rolls back a %s failure with an exact sanitized response',
    async (failure) => {
      const context = await createTestContext();
      const before = context.store.findWaitlistEntryById(1);
      if (failure === 'clock') {
        context.clock.now.mockImplementationOnce(() => {
          throw new Error(`private clock ${morganAction}`);
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
            throw new Error(`private store ${morganAction}`);
          });
      }
      const logs = [
        jest.spyOn(console, 'log').mockImplementation(() => undefined),
        jest.spyOn(console, 'warn').mockImplementation(() => undefined),
        jest.spyOn(console, 'error').mockImplementation(() => undefined),
      ];
      const response = await request(context.app.getHttpServer())
        .patch(`/api/dashboard/waitlist-entries/${morganAction}`)
        .set('Cookie', sessionCookie('demo-restaurant'))
        .send({ resolution: 'seated' })
        .expect(500, unexpectedBody);
      expect(JSON.stringify(response.body)).not.toMatch(
        /private|clock|store|9c777a3d|Morgan|555|stack/i,
      );
      expectNeutralHeaders(response);
      expect(context.store.findWaitlistEntryById(1)).toEqual(before);
      expect(logs.every((log) => log.mock.calls.length === 0)).toBe(true);
      logs.forEach((log) => log.mockRestore());
      await context.app.close();
    },
  );

  it('does not log or return private data on success, validation, or not-found', async () => {
    const context = await createTestContext();
    const logs = [
      jest.spyOn(console, 'log').mockImplementation(() => undefined),
      jest.spyOn(console, 'warn').mockImplementation(() => undefined),
      jest.spyOn(console, 'error').mockImplementation(() => undefined),
    ];
    const responses = [
      await request(context.app.getHttpServer())
        .patch(`/api/dashboard/waitlist-entries/${morganAction}`)
        .set('Cookie', sessionCookie('demo-restaurant'))
        .send({ resolution: 'seated' }),
      await request(context.app.getHttpServer())
        .patch('/api/dashboard/waitlist-entries/missing')
        .set('Cookie', sessionCookie('demo-restaurant'))
        .send({ resolution: 'seated' }),
      await request(context.app.getHttpServer())
        .patch('/api/dashboard/waitlist-entries/missing')
        .set('Cookie', sessionCookie('demo-restaurant'))
        .send({ resolution: 'INVALID' }),
    ];
    expect(responses.map((response) => response.status)).toEqual([
      200, 404, 400,
    ]);
    expect(
      JSON.stringify(responses.map((response) => response.body)),
    ).not.toMatch(
      /9c777a3d|8f4d6e2b|Morgan|555|Demo|position|party|timestamp|restaurant|entry|phone|token|reference/i,
    );
    expect(logs.every((log) => log.mock.calls.length === 0)).toBe(true);
    logs.forEach((log) => log.mockRestore());
    await context.app.close();
  });
});

describe('atomic staff resolution store operation', () => {
  function createStore() {
    const store = new InMemoryStore();
    const restaurant = createRestaurant(store, 'atomic');
    const entry = createEntry(store, restaurant.id, 'atomic');
    if (entry.status !== 'active') {
      throw new Error('Expected active fixture.');
    }
    return { store, restaurant, entry };
  }

  it('checks ownership and active state before one clock read', () => {
    const { store, restaurant, entry } = createStore();
    const now = jest.fn(() => resolutionTime);
    expect(
      store.resolveWaitlistEntryByActionReference(
        restaurant.id,
        entry.actionReference,
        'seated',
        now,
      ),
    ).toMatchObject({ kind: 'resolved', entry: { status: 'seated' } });
    expect(now).toHaveBeenCalledTimes(1);
    expect(
      store.resolveWaitlistEntryByActionReference(
        restaurant.id,
        entry.actionReference,
        'cancelled',
        now,
      ),
    ).toEqual({ kind: 'not-found' });
    expect(now).toHaveBeenCalledTimes(1);
  });

  it('serializes resolution-before-join and join-before-resolution', async () => {
    for (const resolutionFirst of [true, false]) {
      const { store, restaurant, entry } = createStore();
      const resolve = () =>
        store.resolveWaitlistEntryByActionReference(
          restaurant.id,
          entry.actionReference,
          'seated',
          () => resolutionTime,
        );
      const join = () =>
        store.commitWaitlistJoin(restaurant.slug, {
          customerName: 'Replacement',
          phone: entry.phone,
          normalizedPhone: entry.normalizedPhone,
          partySize: 1,
          privateStatusToken: `replacement-private-${String(resolutionFirst)}`,
          actionReference: `replacement-action-${String(resolutionFirst)}`,
          joinedAt: resolutionTime,
        });
      const results = resolutionFirst
        ? await Promise.all([
            Promise.resolve().then(resolve),
            Promise.resolve().then(join),
          ])
        : await Promise.all([
            Promise.resolve().then(join),
            Promise.resolve().then(resolve),
          ]);
      expect(results.map((result) => result.kind)).toEqual(
        resolutionFirst
          ? ['resolved', 'created']
          : ['duplicate-phone', 'resolved'],
      );
      expect(
        store
          .listActiveWaitlistEntries(restaurant.id)
          .filter(
            (candidate) => candidate.normalizedPhone === entry.normalizedPhone,
          ),
      ).toHaveLength(resolutionFirst ? 1 : 0);
    }
  });
});
