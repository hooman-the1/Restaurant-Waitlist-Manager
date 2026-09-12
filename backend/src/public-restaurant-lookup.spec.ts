import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { sign } from 'cookie-signature';
import request = require('supertest');

import { configureApplication } from './application-configuration';
import { AppModule } from './app.module';
import { DEMO_ACCESS } from './demo-data-seeder';
import { InMemoryStore, RestaurantRecord } from './in-memory-store';

const secret = 'public-lookup-test-secret';
const demoSuccess = {
  kind: 'success',
  restaurant: { restaurantName: 'Demo Restaurant' },
};
const notFoundBody = { kind: 'not-found' };
const unexpectedBody = {
  kind: 'unexpected',
  message: 'Something went wrong. Please try again.',
};

interface TestContext {
  app: INestApplication;
  store: InMemoryStore;
}

async function createTestContext(): Promise<TestContext> {
  const module = await Test.createTestingModule({
    imports: [AppModule],
  }).compile();
  const app = module.createNestApplication();
  configureApplication(app, {
    port: 8000,
    secretKey: secret,
    frontendOrigin: 'http://localhost:4200',
  });
  await app.init();

  return { app, store: module.get(InMemoryStore) };
}

function createRestaurant(
  store: InMemoryStore,
  input: { name: string; slug: string; verified: boolean },
): RestaurantRecord {
  return store.createRestaurant({
    name: input.name,
    normalizedName: input.name.toLocaleLowerCase(),
    email: `${input.slug}@example.com`,
    normalizedEmail: `${input.slug}@example.com`,
    passwordHash: `private-hash-${input.slug}`,
    slug: input.slug,
    verified: input.verified,
    createdAt: new Date(2026, 8, 12, 20, 0, 0),
  });
}

function signedCookie(slug: string, signingSecret = secret): string {
  return `restaurant_session=${encodeURIComponent(`s:${sign(slug, signingSecret)}`)}`;
}

function expectNeutralHeaders(response: request.Response): void {
  expect(response.headers['set-cookie']).toBeUndefined();
  expect(response.headers.location).toBeUndefined();
  expect(response.headers['www-authenticate']).toBeUndefined();
  expect(response.headers['cache-control']).toBeUndefined();
}

describe('GET /api/restaurants/:restaurantSlug', () => {
  it('returns the exact public view for the seeded demo without credentials', async () => {
    const context = await createTestContext();

    const response = await request(context.app.getHttpServer())
      .get('/api/restaurants/demo-restaurant')
      .expect(200, demoSuccess);

    expect(response.headers['content-type']).toMatch(/^application\/json/);
    expect(Object.keys(response.body).sort()).toEqual(['kind', 'restaurant']);
    expect(Object.keys(response.body.restaurant)).toEqual(['restaurantName']);
    expectNeutralHeaders(response);
    expect(JSON.stringify(response.body)).not.toMatch(
      /demo@example|DEMO_ONLY|normalized|verified|createdAt|slug|Morgan|Sam|Alex|555|party|position|token|reference|joined|resolved|status/i,
    );
    await context.app.close();
  });

  it.each([
    ['case variant', '/api/restaurants/Demo-Restaurant'],
    ['leading whitespace', '/api/restaurants/%20demo-restaurant'],
    ['trailing whitespace', '/api/restaurants/demo-restaurant%20'],
    ['display name', '/api/restaurants/Demo%20Restaurant'],
    ['internal id', '/api/restaurants/1'],
    ['email', '/api/restaurants/demo%40example.com'],
    ['unknown slug', '/api/restaurants/unknown-restaurant'],
    ['missing segment', '/api/restaurants/'],
  ])('returns exact not-found for a %s', async (_case, path) => {
    const context = await createTestContext();
    const response = await request(context.app.getHttpServer())
      .get(path)
      .expect(404, notFoundBody);

    expect(response.headers['content-type']).toMatch(/^application\/json/);
    expect(Object.keys(response.body)).toEqual(['kind']);
    expectNeutralHeaders(response);
    await context.app.close();
  });

  it('uses the framework-decoded Unicode slug exactly once', async () => {
    const context = await createTestContext();
    const unicodeSlug = 'کافه-你好';
    createRestaurant(context.store, {
      name: 'کافه چای 你好',
      slug: unicodeSlug,
      verified: true,
    });
    createRestaurant(context.store, {
      name: 'Encoded Literal',
      slug: '%E2%98%95',
      verified: true,
    });

    await request(context.app.getHttpServer())
      .get(`/api/restaurants/${encodeURIComponent(unicodeSlug)}`)
      .expect(200, {
        kind: 'success',
        restaurant: { restaurantName: 'کافه چای 你好' },
      });
    await request(context.app.getHttpServer())
      .get('/api/restaurants/%25E2%2598%2595')
      .expect(200, {
        kind: 'success',
        restaurant: { restaurantName: 'Encoded Literal' },
      });
    await context.app.close();
  });

  it.each([
    ['verified', true],
    ['unverified', false],
  ])(
    'returns a %s restaurant because the public waitlist is always open',
    async (_case, verified) => {
      const context = await createTestContext();
      createRestaurant(context.store, {
        name: `Publication ${String(verified)}`,
        slug: `publication-${String(verified)}`,
        verified,
      });

      await request(context.app.getHttpServer())
        .get(`/api/restaurants/publication-${String(verified)}`)
        .expect(200, {
          kind: 'success',
          restaurant: { restaurantName: `Publication ${String(verified)}` },
        });
      await context.app.close();
    },
  );

  it.each([
    ['valid', signedCookie(DEMO_ACCESS.staffSessionPayload)],
    ['unsigned', 'restaurant_session=demo-restaurant'],
    [
      'wrong secret',
      signedCookie(DEMO_ACCESS.staffSessionPayload, 'wrong-secret'),
    ],
    ['tampered', `${signedCookie(DEMO_ACCESS.staffSessionPayload)}x`],
  ])('ignores a %s restaurant session cookie', async (_case, cookie) => {
    const context = await createTestContext();
    const response = await request(context.app.getHttpServer())
      .get('/api/restaurants/demo-restaurant')
      .set('Cookie', cookie)
      .expect(200, demoSuccess);

    expectNeutralHeaders(response);
    await context.app.close();
  });

  it('keeps repeated and concurrent reads independently scoped and leaves all state unchanged', async () => {
    const context = await createTestContext();
    const other = createRestaurant(context.store, {
      name: 'Other Restaurant',
      slug: 'other-restaurant',
      verified: false,
    });
    context.store.createVerificationToken('keep-verification', other.id);
    const entry = context.store.createWaitlistEntry({
      restaurantId: other.id,
      customerName: 'Private Customer',
      phone: '555-9999',
      normalizedPhone: '5559999',
      partySize: 3,
      privateStatusToken: 'keep-private-token',
      actionReference: 'keep-action-reference',
      joinedAt: new Date(2026, 8, 12, 20, 5, 0),
      status: 'active',
    });
    const beforeRestaurant = context.store.findRestaurantById(other.id);
    const beforeToken =
      context.store.findVerificationToken('keep-verification');
    const beforeEntry = context.store.findWaitlistEntryById(entry.id);

    const responses = await Promise.all([
      request(context.app.getHttpServer()).get(
        '/api/restaurants/demo-restaurant',
      ),
      request(context.app.getHttpServer()).get(
        '/api/restaurants/other-restaurant',
      ),
      request(context.app.getHttpServer()).get(
        '/api/restaurants/demo-restaurant',
      ),
      request(context.app.getHttpServer()).get(
        '/api/restaurants/other-restaurant',
      ),
    ]);

    expect(
      responses.map((response) => response.body.restaurant.restaurantName),
    ).toEqual([
      'Demo Restaurant',
      'Other Restaurant',
      'Demo Restaurant',
      'Other Restaurant',
    ]);
    expect(context.store.findRestaurantById(other.id)).toEqual(
      beforeRestaurant,
    );
    expect(context.store.findVerificationToken('keep-verification')).toEqual(
      beforeToken,
    );
    expect(context.store.findWaitlistEntryById(entry.id)).toEqual(beforeEntry);
    const next = createRestaurant(context.store, {
      name: 'Sequence Proof',
      slug: 'sequence-proof',
      verified: true,
    });
    expect(next.id).toBe(other.id + 1);
    await context.app.close();
  });

  it('sanitizes a store lookup failure without logging or leaking request/account details', async () => {
    const context = await createTestContext();
    const log = jest.spyOn(console, 'log').mockImplementation(() => undefined);
    jest
      .spyOn(context.store, 'findRestaurantBySlug')
      .mockImplementationOnce(() => {
        throw new Error('private store detail for failing-slug');
      });

    const response = await request(context.app.getHttpServer())
      .get('/api/restaurants/failing-slug')
      .expect(500, unexpectedBody);

    expect(response.headers['content-type']).toMatch(/^application\/json/);
    expect(Object.keys(response.body).sort()).toEqual(['kind', 'message']);
    expect(JSON.stringify(response.body)).not.toMatch(
      /private|store|failing-slug|stack/i,
    );
    expectNeutralHeaders(response);
    expect(log).not.toHaveBeenCalled();
    log.mockRestore();
    await context.app.close();
  });
});
