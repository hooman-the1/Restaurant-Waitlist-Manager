import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { sign } from 'cookie-signature';
import request = require('supertest');

import { configureApplication } from './application-configuration';
import { AppModule } from './app.module';
import { SystemClock } from './demo-data-seeder';
import { FinalWaitlistStatus, InMemoryStore } from './in-memory-store';

const fixedNow = new Date(2026, 8, 12, 21, 0, 0);
const morganToken = '8f4d6e2b-1a73-4c95-b0e8-62d9f71a3c44';
const samToken = '7a2bfe87-27d4-4e13-8b0d-e7804c1e7421';
const alexToken = 'c2a7198e-6d40-4b53-9f81-37e5a6c04bd2';
const morganAction = '9c777a3d-b7ed-4c86-95ce-7f456a62ff11';
const unexpectedBody = {
  kind: 'unexpected',
  message: 'Something went wrong. Please try again.',
};

interface TestContext {
  app: INestApplication;
  store: InMemoryStore;
}

async function createTestContext(): Promise<TestContext> {
  const module = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(SystemClock)
    .useValue({ now: () => new Date(fixedNow) })
    .compile();
  const app = module.createNestApplication();
  configureApplication(app, {
    port: 8000,
    secretKey: 'private-status-test-secret',
    frontendOrigin: 'http://localhost:4200',
  });
  await app.init();
  return { app, store: module.get(InMemoryStore) };
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
    createdAt: fixedNow,
  });
}

function createEntry(
  store: InMemoryStore,
  restaurantId: number,
  token: string,
  status: 'active' | FinalWaitlistStatus = 'active',
) {
  const base = {
    restaurantId,
    customerName: `Customer ${token}`,
    phone: '555-010-9000',
    normalizedPhone: `5550109${restaurantId}${token.length}`,
    partySize: 2,
    privateStatusToken: token,
    actionReference: `action-${token}`,
    joinedAt: fixedNow,
  };
  return status === 'active'
    ? store.createWaitlistEntry({ ...base, status })
    : store.createWaitlistEntry({
        ...base,
        status,
        resolvedAt: new Date(fixedNow.getTime() + 1_000),
      });
}

function expectPrivateHeaders(response: request.Response): void {
  expect(response.headers['cache-control']).toBe('no-store');
  expect(response.headers['set-cookie']).toBeUndefined();
  expect(response.headers.location).toBeUndefined();
  expect(response.headers['www-authenticate']).toBeUndefined();
}

describe('GET /api/waitlist-entries/:privateToken', () => {
  it('returns the exact seeded active view with a fresh FIFO position', async () => {
    const context = await createTestContext();
    const response = await request(context.app.getHttpServer())
      .get(`/api/waitlist-entries/${morganToken}`)
      .expect(200, {
        kind: 'active',
        restaurantName: 'Demo Restaurant',
        position: 1,
      });

    expect(response.headers['content-type']).toMatch(/^application\/json/);
    expect(Object.keys(response.body).sort()).toEqual([
      'kind',
      'position',
      'restaurantName',
    ]);
    expectPrivateHeaders(response);
    await context.app.close();
  });

  it('keeps equal-time active entries in insertion order', async () => {
    const context = await createTestContext();
    await request(context.app.getHttpServer())
      .get(`/api/waitlist-entries/${morganToken}`)
      .expect(200, {
        kind: 'active',
        restaurantName: 'Demo Restaurant',
        position: 1,
      });
    await request(context.app.getHttpServer())
      .get(`/api/waitlist-entries/${samToken}`)
      .expect(200, {
        kind: 'active',
        restaurantName: 'Demo Restaurant',
        position: 2,
      });
    await context.app.close();
  });

  it('recalculates positions after resolution while later inserts do not move earlier entries', async () => {
    const context = await createTestContext();
    expect(
      context.store.resolveWaitlistEntry(1, 'seated', fixedNow),
    ).toBeDefined();

    await request(context.app.getHttpServer())
      .get(`/api/waitlist-entries/${samToken}`)
      .expect(200, {
        kind: 'active',
        restaurantName: 'Demo Restaurant',
        position: 1,
      });
    createEntry(context.store, 1, 'later-token');
    await request(context.app.getHttpServer())
      .get(`/api/waitlist-entries/${samToken}`)
      .expect(200, {
        kind: 'active',
        restaurantName: 'Demo Restaurant',
        position: 1,
      });
    await request(context.app.getHttpServer())
      .get('/api/waitlist-entries/later-token')
      .expect(200, {
        kind: 'active',
        restaurantName: 'Demo Restaurant',
        position: 2,
      });
    await context.app.close();
  });

  it('excludes resolved and other-restaurant entries from active positions', async () => {
    const context = await createTestContext();
    const other = createRestaurant(context.store, 'other');
    createEntry(context.store, other.id, 'other-first');
    createEntry(context.store, 1, 'resolved-between', 'cancelled');
    createEntry(context.store, 1, 'demo-later');

    await request(context.app.getHttpServer())
      .get('/api/waitlist-entries/demo-later')
      .expect(200, {
        kind: 'active',
        restaurantName: 'Demo Restaurant',
        position: 3,
      });
    await request(context.app.getHttpServer())
      .get('/api/waitlist-entries/other-first')
      .expect(200, {
        kind: 'active',
        restaurantName: 'Restaurant other',
        position: 1,
      });
    await context.app.close();
  });

  it('uses insertion order instead of party size or joined timestamp', async () => {
    const context = await createTestContext();
    const restaurant = createRestaurant(context.store, 'fifo');
    context.store.createWaitlistEntry({
      restaurantId: restaurant.id,
      customerName: 'First inserted',
      phone: '100',
      normalizedPhone: '100',
      partySize: 30,
      privateStatusToken: 'fifo-first',
      actionReference: 'fifo-first-action',
      joinedAt: new Date(fixedNow.getTime() + 60_000),
      status: 'active',
    });
    context.store.createWaitlistEntry({
      restaurantId: restaurant.id,
      customerName: 'Second inserted',
      phone: '200',
      normalizedPhone: '200',
      partySize: 1,
      privateStatusToken: 'fifo-second',
      actionReference: 'fifo-second-action',
      joinedAt: new Date(fixedNow.getTime() - 60_000),
      status: 'active',
    });

    await request(context.app.getHttpServer())
      .get('/api/waitlist-entries/fifo-first')
      .expect(200, {
        kind: 'active',
        restaurantName: 'Restaurant fifo',
        position: 1,
      });
    await request(context.app.getHttpServer())
      .get('/api/waitlist-entries/fifo-second')
      .expect(200, {
        kind: 'active',
        restaurantName: 'Restaurant fifo',
        position: 2,
      });
    await context.app.close();
  });

  it('returns the exact seeded resolved view without position', async () => {
    const context = await createTestContext();
    const response = await request(context.app.getHttpServer())
      .get(`/api/waitlist-entries/${alexToken}`)
      .expect(200, {
        kind: 'resolved',
        restaurantName: 'Demo Restaurant',
        finalStatus: 'seated',
      });

    expect(Object.keys(response.body).sort()).toEqual([
      'finalStatus',
      'kind',
      'restaurantName',
    ]);
    expectPrivateHeaders(response);
    await context.app.close();
  });

  it.each(['seated', 'cancelled', 'no-show'] as const)(
    'returns the exact %s final status until removal',
    async (status) => {
      const context = await createTestContext();
      const entry = createEntry(context.store, 1, `resolved-${status}`, status);
      await request(context.app.getHttpServer())
        .get(`/api/waitlist-entries/${entry.privateStatusToken}`)
        .expect(200, {
          kind: 'resolved',
          restaurantName: 'Demo Restaurant',
          finalStatus: status,
        });
      expect(context.store.removeWaitlistEntry(entry.id)).toBe(true);
      const removed = await request(context.app.getHttpServer())
        .get(`/api/waitlist-entries/${entry.privateStatusToken}`)
        .expect(404, { kind: 'not-found' });
      expectPrivateHeaders(removed);
      await context.app.close();
    },
  );

  it.each([
    'unknown-token',
    morganToken.toUpperCase(),
    `%20${morganToken}%20`,
    'demo-restaurant',
    '1',
    morganAction,
  ])(
    'returns an exact cached-disabled 404 for non-matching token %s',
    async (token) => {
      const context = await createTestContext();
      const response = await request(context.app.getHttpServer())
        .get(`/api/waitlist-entries/${token}`)
        .expect(404, { kind: 'not-found' });
      expectPrivateHeaders(response);
      await context.app.close();
    },
  );

  it('uses exactly the framework single-decoded token', async () => {
    const context = await createTestContext();
    createEntry(context.store, 1, '%61');

    await request(context.app.getHttpServer())
      .get('/api/waitlist-entries/%2561')
      .expect(200, {
        kind: 'active',
        restaurantName: 'Demo Restaurant',
        position: 3,
      });
    await request(context.app.getHttpServer())
      .get('/api/waitlist-entries/%61')
      .expect(404, { kind: 'not-found' });
    await context.app.close();
  });

  it('returns not found for an entry whose restaurant is missing', async () => {
    const context = await createTestContext();
    createEntry(context.store, 999, 'orphan-token');
    const response = await request(context.app.getHttpServer())
      .get('/api/waitlist-entries/orphan-token')
      .expect(404, { kind: 'not-found' });
    expectPrivateHeaders(response);
    await context.app.close();
  });

  it.each([
    ['missing', undefined],
    [
      'valid',
      `restaurant_session=${encodeURIComponent(
        `s:${sign('demo-restaurant', 'private-status-test-secret')}`,
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
        `s:${sign('unknown', 'private-status-test-secret')}`,
      )}`,
    ],
  ])('ignores the %s restaurant session', async (_case, cookie) => {
    const context = await createTestContext();
    const call = request(context.app.getHttpServer()).get(
      `/api/waitlist-entries/${morganToken}`,
    );
    if (cookie !== undefined) {
      call.set('Cookie', cookie);
    }
    const response = await call.expect(200, {
      kind: 'active',
      restaurantName: 'Demo Restaurant',
      position: 1,
    });
    expectPrivateHeaders(response);
    await context.app.close();
  });

  it('ignores a signed session for an unverified restaurant', async () => {
    const context = await createTestContext();
    const restaurant = createRestaurant(context.store, 'unverified');
    context.store.updateRestaurant(restaurant.id, { verified: false });
    const cookie = `restaurant_session=${encodeURIComponent(
      `s:${sign(restaurant.slug, 'private-status-test-secret')}`,
    )}`;
    const response = await request(context.app.getHttpServer())
      .get(`/api/waitlist-entries/${morganToken}`)
      .set('Cookie', cookie)
      .expect(200, {
        kind: 'active',
        restaurantName: 'Demo Restaurant',
        position: 1,
      });
    expectPrivateHeaders(response);
    await context.app.close();
  });

  it.each([morganToken, alexToken])(
    'does not expose private entry, account, queue, or capability fields for %s',
    async (token) => {
      const context = await createTestContext();
      const response = await request(context.app.getHttpServer())
        .get(`/api/waitlist-entries/${token}`)
        .expect(200);
      expect(JSON.stringify(response.body)).not.toMatch(
        /customer|phone|party|joined|resolvedAt|waitlist|restaurantId|normalized|email|password|verified|token|reference|queue|count|ahead|estimate|next/i,
      );
      if (response.body.kind === 'resolved') {
        expect(response.body.position).toBeUndefined();
      }
      await context.app.close();
    },
  );

  it('sanitizes store failures, disables caching, and logs no private data', async () => {
    const context = await createTestContext();
    const readableStore = context.store as InMemoryStore & {
      readPrivateWaitlistStatus(token: string): unknown;
    };
    jest
      .spyOn(readableStore, 'readPrivateWaitlistStatus')
      .mockImplementationOnce(() => {
        throw new Error(`private failure ${morganToken}`);
      });
    const logs = [
      jest.spyOn(console, 'log').mockImplementation(() => undefined),
      jest.spyOn(console, 'warn').mockImplementation(() => undefined),
      jest.spyOn(console, 'error').mockImplementation(() => undefined),
    ];

    const response = await request(context.app.getHttpServer())
      .get(`/api/waitlist-entries/${morganToken}`)
      .expect(500, unexpectedBody);
    expect(response.headers['content-type']).toMatch(/^application\/json/);
    expect(JSON.stringify(response.body)).not.toContain(morganToken);
    expectPrivateHeaders(response);
    expect(logs.every((log) => log.mock.calls.length === 0)).toBe(true);
    logs.forEach((log) => log.mockRestore());
    await context.app.close();
  });

  it('does not log successful or missing private tokens', async () => {
    const context = await createTestContext();
    const logs = [
      jest.spyOn(console, 'log').mockImplementation(() => undefined),
      jest.spyOn(console, 'warn').mockImplementation(() => undefined),
      jest.spyOn(console, 'error').mockImplementation(() => undefined),
    ];
    await request(context.app.getHttpServer())
      .get(`/api/waitlist-entries/${morganToken}`)
      .expect(200);
    await request(context.app.getHttpServer())
      .get('/api/waitlist-entries/missing-private-token')
      .expect(404);
    expect(logs.every((log) => log.mock.calls.length === 0)).toBe(true);
    logs.forEach((log) => log.mockRestore());
    await context.app.close();
  });

  it('returns only a coherent active or resolved view across a concurrent transition', async () => {
    const context = await createTestContext();
    const lookup = request(context.app.getHttpServer()).get(
      `/api/waitlist-entries/${morganToken}`,
    );
    const transition = Promise.resolve().then(() =>
      context.store.resolveWaitlistEntry(1, 'cancelled', fixedNow),
    );
    const [response] = await Promise.all([lookup, transition]);

    expect([
      {
        kind: 'active',
        restaurantName: 'Demo Restaurant',
        position: 1,
      },
      {
        kind: 'resolved',
        restaurantName: 'Demo Restaurant',
        finalStatus: 'cancelled',
      },
    ]).toContainEqual(response.body);
    expectPrivateHeaders(response);
    await context.app.close();
  });

  it('keeps concurrent token and restaurant lookups independently scoped', async () => {
    const context = await createTestContext();
    const other = createRestaurant(context.store, 'parallel');
    createEntry(context.store, other.id, 'parallel-one');
    createEntry(context.store, other.id, 'parallel-two');

    const responses = await Promise.all([
      request(context.app.getHttpServer()).get(
        `/api/waitlist-entries/${samToken}`,
      ),
      request(context.app.getHttpServer()).get(
        '/api/waitlist-entries/parallel-two',
      ),
    ]);
    expect(responses.map((response) => response.body)).toEqual([
      {
        kind: 'active',
        restaurantName: 'Demo Restaurant',
        position: 2,
      },
      {
        kind: 'active',
        restaurantName: 'Restaurant parallel',
        position: 2,
      },
    ]);
    await context.app.close();
  });

  it('keeps repeated and concurrent reads fully read-only, including ID sequences', async () => {
    const context = await createTestContext();
    const before = [1, 2, 3].map((id) =>
      context.store.findWaitlistEntryById(id),
    );

    await Promise.all(
      Array.from({ length: 12 }, (_, index) =>
        request(context.app.getHttpServer()).get(
          `/api/waitlist-entries/${index % 2 === 0 ? morganToken : alexToken}`,
        ),
      ),
    );

    expect(
      [1, 2, 3].map((id) => context.store.findWaitlistEntryById(id)),
    ).toEqual(before);
    const restaurant = createRestaurant(context.store, 'after-reads');
    expect(restaurant.id).toBe(2);
    expect(createEntry(context.store, restaurant.id, 'after-reads').id).toBe(4);
    await context.app.close();
  });
});
