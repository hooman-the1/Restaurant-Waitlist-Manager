import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { sign } from 'cookie-signature';
import { NextFunction, Request, Response } from 'express';
import request = require('supertest');

import { configureApplication } from './application-configuration';
import { AppModule } from './app.module';
import { SystemClock } from './demo-data-seeder';
import {
  FinalWaitlistStatus,
  InMemoryStore,
  WaitlistEntryRecord,
} from './in-memory-store';
import { RestaurantSessionGuard } from './restaurant-session';

const secret = 'dashboard-test-secret';
const seedNow = new Date(2026, 8, 12, 12, 0, 0);
const morganAction = '9c777a3d-b7ed-4c86-95ce-7f456a62ff11';
const samAction = 'c5f2a8d4-6b31-47e0-9a25-2d8e6c714903';
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
  now?: Date;
  signedCookieValue?: unknown;
}): Promise<TestContext> {
  const clock = { now: jest.fn(() => new Date(seedNow)) };
  const builder = Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(SystemClock)
    .useValue(clock);
  const module = await builder.compile();
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
  clock.now.mockImplementation(() => new Date(options?.now ?? seedNow));
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
    createdAt: seedNow,
  });
}

function createEntry(
  store: InMemoryStore,
  restaurantId: number,
  suffix: string,
  options?: {
    status?: 'active' | FinalWaitlistStatus;
    joinedAt?: Date;
    resolvedAt?: Date;
    partySize?: number;
  },
): WaitlistEntryRecord {
  const status = options?.status ?? 'active';
  const base = {
    restaurantId,
    customerName: `Customer ${suffix}`,
    phone: `Phone ${suffix}`,
    normalizedPhone: `normalized-${suffix}`,
    partySize: options?.partySize ?? 2,
    privateStatusToken: `private-${suffix}`,
    actionReference: `action-${suffix}`,
    joinedAt: options?.joinedAt ?? seedNow,
  };
  return status === 'active'
    ? store.createWaitlistEntry({ ...base, status })
    : store.createWaitlistEntry({
        ...base,
        status,
        resolvedAt: options?.resolvedAt ?? seedNow,
      });
}

function expectDashboardHeaders(response: request.Response): void {
  expect(response.headers['cache-control']).toBe('no-store');
  expect(response.headers['set-cookie']).toBeUndefined();
  expect(response.headers.location).toBeUndefined();
  expect(response.headers['www-authenticate']).toBeUndefined();
}

describe('GET /api/dashboard', () => {
  it('returns the exact seeded restaurant-scoped dashboard projection', async () => {
    const context = await createTestContext();
    const response = await request(context.app.getHttpServer())
      .get('/api/dashboard')
      .set('Cookie', sessionCookie('demo-restaurant'))
      .expect(200, {
        kind: 'success',
        dashboard: {
          restaurantName: 'Demo Restaurant',
          activeEntries: [
            {
              position: 1,
              customerName: 'Morgan Lee',
              phone: '(555) 010-1000',
              partySize: 6,
              actionReference: morganAction,
            },
            {
              position: 2,
              customerName: 'Sam Rivera',
              phone: '555-010-2000',
              partySize: 2,
              actionReference: samAction,
            },
          ],
          resolvedToday: [
            {
              customerName: 'Alex Chen',
              partySize: 4,
              finalStatus: 'seated',
            },
          ],
        },
      });

    expect(response.headers['content-type']).toMatch(/^application\/json/);
    expect(Object.keys(response.body).sort()).toEqual(['dashboard', 'kind']);
    expect(Object.keys(response.body.dashboard).sort()).toEqual([
      'activeEntries',
      'resolvedToday',
      'restaurantName',
    ]);
    expect(
      Object.keys(response.body.dashboard.activeEntries[0]).sort(),
    ).toEqual([
      'actionReference',
      'customerName',
      'partySize',
      'phone',
      'position',
    ]);
    expect(
      Object.keys(response.body.dashboard.resolvedToday[0]).sort(),
    ).toEqual(['customerName', 'finalStatus', 'partySize']);
    expect(context.clock.now).toHaveBeenCalledTimes(1);
    expectDashboardHeaders(response);
    await context.app.close();
  });

  it('returns both empty arrays and the stored display name for an empty restaurant', async () => {
    const context = await createTestContext();
    const restaurant = createRestaurant(context.store, 'empty');
    await request(context.app.getHttpServer())
      .get('/api/dashboard')
      .set('Cookie', sessionCookie(restaurant.slug))
      .expect(200, {
        kind: 'success',
        dashboard: {
          restaurantName: restaurant.name,
          activeEntries: [],
          resolvedToday: [],
        },
      });
    await context.app.close();
  });

  it('recalculates contiguous FIFO positions without sorting by time or party size', async () => {
    const context = await createTestContext();
    createEntry(context.store, 1, 'first-later-time', {
      joinedAt: new Date(seedNow.getTime() + 60_000),
      partySize: 30,
    });
    createEntry(context.store, 1, 'second-earlier-time', {
      joinedAt: new Date(seedNow.getTime() - 60_000),
      partySize: 1,
    });
    context.store.resolveWaitlistEntry(1, 'cancelled', seedNow);

    const response = await request(context.app.getHttpServer())
      .get('/api/dashboard')
      .set('Cookie', sessionCookie('demo-restaurant'))
      .expect(200);
    expect(
      response.body.dashboard.activeEntries.map(
        (entry: { position: number; customerName: string }) => [
          entry.position,
          entry.customerName,
        ],
      ),
    ).toEqual([
      [1, 'Sam Rivera'],
      [2, 'Customer first-later-time'],
      [3, 'Customer second-earlier-time'],
    ]);
    await context.app.close();
  });

  it('uses inclusive local start and exclusive next local midnight for every final status', async () => {
    const current = new Date(2026, 8, 12, 12, 30, 0);
    const start = new Date(2026, 8, 12, 0, 0, 0, 0);
    const next = new Date(2026, 8, 13, 0, 0, 0, 0);
    const context = await createTestContext({ now: current });
    const restaurant = createRestaurant(context.store, 'boundaries');
    createEntry(context.store, restaurant.id, 'start-seated', {
      status: 'seated',
      resolvedAt: start,
    });
    createEntry(context.store, restaurant.id, 'middle-cancelled', {
      status: 'cancelled',
      resolvedAt: current,
    });
    createEntry(context.store, restaurant.id, 'end-no-show', {
      status: 'no-show',
      resolvedAt: new Date(next.getTime() - 1),
    });
    createEntry(context.store, restaurant.id, 'previous', {
      status: 'seated',
      resolvedAt: new Date(start.getTime() - 1),
    });
    createEntry(context.store, restaurant.id, 'next-midnight', {
      status: 'cancelled',
      resolvedAt: next,
    });
    createEntry(context.store, restaurant.id, 'future', {
      status: 'no-show',
      resolvedAt: new Date(next.getTime() + 86_400_000),
    });
    createEntry(context.store, restaurant.id, 'old-active', {
      joinedAt: new Date(start.getTime() - 86_400_000),
    });

    const response = await request(context.app.getHttpServer())
      .get('/api/dashboard')
      .set('Cookie', sessionCookie(restaurant.slug))
      .expect(200);
    expect(response.body.dashboard.resolvedToday).toEqual([
      {
        customerName: 'Customer start-seated',
        partySize: 2,
        finalStatus: 'seated',
      },
      {
        customerName: 'Customer middle-cancelled',
        partySize: 2,
        finalStatus: 'cancelled',
      },
      {
        customerName: 'Customer end-no-show',
        partySize: 2,
        finalStatus: 'no-show',
      },
    ]);
    expect(response.body.dashboard.activeEntries).toEqual([
      {
        position: 1,
        customerName: 'Customer old-active',
        phone: 'Phone old-active',
        partySize: 2,
        actionReference: 'action-old-active',
      },
    ]);
    expect(context.clock.now).toHaveBeenCalledTimes(1);
    await context.app.close();
  });

  it('constructs calendar midnights safely across a DST-short day', async () => {
    const current = new Date(2026, 2, 8, 12, 0, 0);
    const start = new Date(2026, 2, 8, 0, 0, 0, 0);
    const next = new Date(2026, 2, 9, 0, 0, 0, 0);
    const context = await createTestContext({ now: current });
    const restaurant = createRestaurant(context.store, 'dst');
    createEntry(context.store, restaurant.id, 'dst-start', {
      status: 'seated',
      resolvedAt: start,
    });
    createEntry(context.store, restaurant.id, 'dst-end', {
      status: 'cancelled',
      resolvedAt: new Date(next.getTime() - 1),
    });
    createEntry(context.store, restaurant.id, 'dst-next', {
      status: 'no-show',
      resolvedAt: next,
    });

    const response = await request(context.app.getHttpServer())
      .get('/api/dashboard')
      .set('Cookie', sessionCookie(restaurant.slug))
      .expect(200);
    expect(
      response.body.dashboard.resolvedToday.map(
        (entry: { customerName: string }) => entry.customerName,
      ),
    ).toEqual(['Customer dst-start', 'Customer dst-end']);
    await context.app.close();
  });

  it('keeps concurrent restaurant snapshots independently scoped', async () => {
    const context = await createTestContext();
    const first = createRestaurant(context.store, 'first');
    const second = createRestaurant(context.store, 'second');
    createEntry(context.store, first.id, 'shared', { partySize: 4 });
    createEntry(context.store, second.id, 'shared', { partySize: 4 });

    const responses = await Promise.all([
      request(context.app.getHttpServer())
        .get('/api/dashboard')
        .set('Cookie', sessionCookie(first.slug)),
      request(context.app.getHttpServer())
        .get('/api/dashboard')
        .set('Cookie', sessionCookie(second.slug)),
    ]);
    expect(
      responses.map((response) => ({
        restaurantName: response.body.dashboard.restaurantName,
        names: response.body.dashboard.activeEntries.map(
          (entry: { customerName: string }) => entry.customerName,
        ),
      })),
    ).toEqual([
      { restaurantName: first.name, names: ['Customer shared'] },
      { restaurantName: second.name, names: ['Customer shared'] },
    ]);
    expect(context.clock.now).toHaveBeenCalledTimes(2);
    await context.app.close();
  });

  it.each([
    ['missing', undefined],
    ['unsigned', 'restaurant_session=demo-restaurant'],
    ['tampered', 'restaurant_session=s%3Atampered'],
    ['wrong secret', sessionCookie('demo-restaurant', 'wrong-secret')],
    ['empty', sessionCookie('')],
    ['unknown', sessionCookie('unknown')],
  ])(
    'returns cached-disabled unauthorized for a %s session',
    async (_case, cookie) => {
      const context = await createTestContext();
      const readableStore = context.store as InMemoryStore & {
        readDashboardSnapshot(restaurantId: number, now: Date): unknown;
      };
      const dashboardRead = jest.spyOn(readableStore, 'readDashboardSnapshot');
      const logs = [
        jest.spyOn(console, 'log').mockImplementation(() => undefined),
        jest.spyOn(console, 'warn').mockImplementation(() => undefined),
        jest.spyOn(console, 'error').mockImplementation(() => undefined),
      ];
      const call = request(context.app.getHttpServer()).get('/api/dashboard');
      if (cookie !== undefined) {
        call.set('Cookie', cookie);
      }
      const response = await call.expect(401, { kind: 'unauthorized' });
      expect(context.clock.now).not.toHaveBeenCalled();
      expect(dashboardRead).not.toHaveBeenCalled();
      expect(logs.every((log) => log.mock.calls.length === 0)).toBe(true);
      logs.forEach((log) => log.mockRestore());
      expectDashboardHeaders(response);
      await context.app.close();
    },
  );

  it('rejects a non-string signed-cookie value before dashboard work', async () => {
    const context = await createTestContext({ signedCookieValue: 42 });
    const response = await request(context.app.getHttpServer())
      .get('/api/dashboard')
      .expect(401, { kind: 'unauthorized' });
    expect(context.clock.now).not.toHaveBeenCalled();
    expectDashboardHeaders(response);
    await context.app.close();
  });

  it('rejects a valid signed cookie for an unverified restaurant', async () => {
    const context = await createTestContext();
    const restaurant = createRestaurant(context.store, 'unverified', false);
    const response = await request(context.app.getHttpServer())
      .get('/api/dashboard')
      .set('Cookie', sessionCookie(restaurant.slug))
      .expect(401, { kind: 'unauthorized' });
    expect(context.clock.now).not.toHaveBeenCalled();
    expectDashboardHeaders(response);
    await context.app.close();
  });

  it('sanitizes an unexpected authentication-guard failure with no-store', async () => {
    const context = await createTestContext();
    jest
      .spyOn(context.sessionGuard, 'canActivate')
      .mockImplementationOnce(() => {
        throw new Error('private guard failure');
      });
    const logs = [
      jest.spyOn(console, 'log').mockImplementation(() => undefined),
      jest.spyOn(console, 'warn').mockImplementation(() => undefined),
      jest.spyOn(console, 'error').mockImplementation(() => undefined),
    ];
    const response = await request(context.app.getHttpServer())
      .get('/api/dashboard')
      .set('Cookie', sessionCookie('demo-restaurant'))
      .expect(500, unexpectedBody);
    expect(context.clock.now).not.toHaveBeenCalled();
    expect(logs.every((log) => log.mock.calls.length === 0)).toBe(true);
    logs.forEach((log) => log.mockRestore());
    expectDashboardHeaders(response);
    await context.app.close();
  });

  it.each(['clock', 'store'])(
    'sanitizes a %s failure without leaking or mutating data',
    async (failure) => {
      const context = await createTestContext();
      const before = [1, 2, 3].map((id) =>
        context.store.findWaitlistEntryById(id),
      );
      if (failure === 'clock') {
        context.clock.now.mockImplementationOnce(() => {
          throw new Error('private dashboard clock');
        });
      } else {
        const readableStore = context.store as InMemoryStore & {
          readDashboardSnapshot(restaurantId: number, now: Date): unknown;
        };
        jest
          .spyOn(readableStore, 'readDashboardSnapshot')
          .mockImplementationOnce(() => {
            throw new Error('private dashboard store Morgan 555');
          });
      }
      const logs = [
        jest.spyOn(console, 'log').mockImplementation(() => undefined),
        jest.spyOn(console, 'warn').mockImplementation(() => undefined),
        jest.spyOn(console, 'error').mockImplementation(() => undefined),
      ];

      const response = await request(context.app.getHttpServer())
        .get('/api/dashboard')
        .set('Cookie', sessionCookie('demo-restaurant'))
        .expect(500, unexpectedBody);
      expect(JSON.stringify(response.body)).not.toMatch(
        /private|dashboard|clock|store|Morgan|555|demo-restaurant|stack/i,
      );
      expect(
        [1, 2, 3].map((id) => context.store.findWaitlistEntryById(id)),
      ).toEqual(before);
      expect(logs.every((log) => log.mock.calls.length === 0)).toBe(true);
      logs.forEach((log) => log.mockRestore());
      expectDashboardHeaders(response);
      await context.app.close();
    },
  );

  it('exposes only dashboard contract fields and logs no private data', async () => {
    const context = await createTestContext();
    const logs = [
      jest.spyOn(console, 'log').mockImplementation(() => undefined),
      jest.spyOn(console, 'warn').mockImplementation(() => undefined),
      jest.spyOn(console, 'error').mockImplementation(() => undefined),
    ];
    const response = await request(context.app.getHttpServer())
      .get('/api/dashboard')
      .set('Cookie', sessionCookie('demo-restaurant'))
      .expect(200);

    expect(JSON.stringify(response.body)).not.toMatch(
      /email|normalized|slug|publicUrl|password|verified|restaurantId|entryId|privateStatus|joinedAt|resolvedAt|queueTotal|analytics|session/i,
    );
    expect(response.body.dashboard.activeEntries[0]).not.toHaveProperty(
      'status',
    );
    expect(response.body.dashboard.resolvedToday[0]).not.toHaveProperty(
      'phone',
    );
    expect(response.body.dashboard.resolvedToday[0]).not.toHaveProperty(
      'actionReference',
    );
    expect(logs.every((log) => log.mock.calls.length === 0)).toBe(true);
    logs.forEach((log) => log.mockRestore());
    await context.app.close();
  });

  it('returns one coherent pre-transition or post-transition snapshot', async () => {
    const context = await createTestContext();
    const dashboard = request(context.app.getHttpServer())
      .get('/api/dashboard')
      .set('Cookie', sessionCookie('demo-restaurant'));
    const transition = Promise.resolve().then(() =>
      context.store.resolveWaitlistEntry(1, 'cancelled', seedNow),
    );
    const [response] = await Promise.all([dashboard, transition]);
    const activeIds = response.body.dashboard.activeEntries.map(
      (entry: { customerName: string }) => entry.customerName,
    );
    const resolvedIds = response.body.dashboard.resolvedToday.map(
      (entry: { customerName: string }) => entry.customerName,
    );
    expect(
      (activeIds.includes('Morgan Lee') &&
        !resolvedIds.includes('Morgan Lee')) ||
        (!activeIds.includes('Morgan Lee') &&
          resolvedIds.includes('Morgan Lee')),
    ).toBe(true);
    expect(
      response.body.dashboard.activeEntries.map(
        (entry: { position: number }) => entry.position,
      ),
    ).toEqual(
      Array.from(
        { length: response.body.dashboard.activeEntries.length },
        (_, index) => index + 1,
      ),
    );
    await context.app.close();
  });

  it('classifies a transition at midnight against one request clock value', async () => {
    const nextMidnight = new Date(2026, 8, 13, 0, 0, 0, 0);
    const context = await createTestContext({ now: nextMidnight });
    const dashboard = request(context.app.getHttpServer())
      .get('/api/dashboard')
      .set('Cookie', sessionCookie('demo-restaurant'));
    const transition = Promise.resolve().then(() =>
      context.store.resolveWaitlistEntry(1, 'seated', nextMidnight),
    );
    const [response] = await Promise.all([dashboard, transition]);
    const active = response.body.dashboard.activeEntries.some(
      (entry: { customerName: string }) => entry.customerName === 'Morgan Lee',
    );
    const resolved = response.body.dashboard.resolvedToday.some(
      (entry: { customerName: string; finalStatus: string }) =>
        entry.customerName === 'Morgan Lee' && entry.finalStatus === 'seated',
    );
    expect(active === !resolved).toBe(true);
    expect(context.clock.now).toHaveBeenCalledTimes(1);
    await context.app.close();
  });

  it('keeps repeated and concurrent reads fully read-only, including counters', async () => {
    const context = await createTestContext();
    const before = [1, 2, 3].map((id) =>
      context.store.findWaitlistEntryById(id),
    );
    await Promise.all(
      Array.from({ length: 12 }, () =>
        request(context.app.getHttpServer())
          .get('/api/dashboard')
          .set('Cookie', sessionCookie('demo-restaurant')),
      ),
    );

    expect(
      [1, 2, 3].map((id) => context.store.findWaitlistEntryById(id)),
    ).toEqual(before);
    expect(createRestaurant(context.store, 'after-reads').id).toBe(2);
    expect(createEntry(context.store, 1, 'after-reads').id).toBe(4);
    expect(context.clock.now).toHaveBeenCalledTimes(12);
    await context.app.close();
  });
});
