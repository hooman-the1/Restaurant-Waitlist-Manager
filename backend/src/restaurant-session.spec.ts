import {
  Controller,
  ExecutionContext,
  Get,
  INestApplication,
  UseGuards,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { sign } from 'cookie-signature';
import { NextFunction, Request, Response } from 'express';
import request = require('supertest');

import { configureApplication } from './application-configuration';
import { AppModule } from './app.module';
import { DEMO_ACCESS } from './demo-data-seeder';
import { InMemoryStore, RestaurantRecord } from './in-memory-store';
import { RestaurantSessionSigner } from './restaurant-verification';
import {
  CurrentRestaurant,
  RestaurantPrincipal,
  RestaurantSessionGuard,
} from './restaurant-session';

const secret = 'session-test-secret';
const unauthorizedBody = { kind: 'unauthorized' };
const unexpectedBody = {
  kind: 'unexpected',
  message: 'Something went wrong. Please try again.',
};
let protectedHandlerCalls = 0;

@Controller('guard-probe')
@UseGuards(RestaurantSessionGuard)
class GuardProbeController {
  @Get()
  probe(@CurrentRestaurant() principal: RestaurantPrincipal): unknown {
    protectedHandlerCalls += 1;
    const originalName = principal.name;
    try {
      (principal as { name: string }).name = 'mutated';
    } catch {
      // Frozen snapshots reject mutation in strict mode.
    }

    return {
      principal,
      keys: Object.keys(principal).sort(),
      frozen: Object.isFrozen(principal),
      mutationRejected: principal.name === originalName,
    };
  }
}

interface TestContext {
  app: INestApplication;
  store: InMemoryStore;
}

async function createTestContext(): Promise<TestContext> {
  const module = await Test.createTestingModule({
    imports: [AppModule],
    controllers: [GuardProbeController],
  })
    .overrideProvider(RestaurantSessionSigner)
    .useValue(
      new RestaurantSessionSigner(new ConfigService({ SECRET_KEY: secret })),
    )
    .compile();
  const app = module.createNestApplication();
  configureApplication(app, {
    port: 8000,
    secretKey: secret,
    frontendOrigin: 'http://localhost:4200',
  });
  app.use((incoming: Request, _response: Response, next: NextFunction) => {
    if (incoming.headers['x-simulate-cookie-access-failure'] === 'true') {
      incoming.signedCookies = new Proxy(Object.create(null) as object, {
        getOwnPropertyDescriptor: () => {
          throw new Error('private signed-cookie accessor detail');
        },
      });
    }
    next();
  });
  await app.init();
  protectedHandlerCalls = 0;

  return { app, store: module.get(InMemoryStore) };
}

function signedCookie(slug: string, signingSecret = secret): string {
  return `restaurant_session=${encodeURIComponent(`s:${sign(slug, signingSecret)}`)}`;
}

function createRestaurant(
  store: InMemoryStore,
  suffix: string,
  verified: boolean,
): RestaurantRecord {
  return store.createRestaurant({
    name: `Restaurant ${suffix}`,
    normalizedName: `restaurant ${suffix}`,
    email: `${suffix}@example.com`,
    normalizedEmail: `${suffix}@example.com`,
    passwordHash: `hash-${suffix}`,
    slug: `restaurant-${suffix}`,
    verified,
    createdAt: new Date(2026, 8, 12, 19, 0, 0),
  });
}

describe('GET /api/restaurant-session', () => {
  it('accepts the exact signed demo slug and returns only allowed without refreshing it', async () => {
    const context = await createTestContext();

    const response = await request(context.app.getHttpServer())
      .get('/api/restaurant-session')
      .set('Cookie', signedCookie(DEMO_ACCESS.staffSessionPayload))
      .expect(200, { kind: 'allowed' });

    expect(response.headers['content-type']).toMatch(/^application\/json/);
    expect(Object.keys(response.body)).toEqual(['kind']);
    expect(response.headers['set-cookie']).toBeUndefined();
    expect(response.headers.location).toBeUndefined();
    expect(response.headers['cache-control']).toBeUndefined();
    await context.app.close();
  });

  it('accepts a cookie newly issued by restaurant verification', async () => {
    const context = await createTestContext();
    const restaurant = createRestaurant(context.store, 'new', false);
    context.store.createVerificationToken('new-verification', restaurant.id);

    const verification = await request(context.app.getHttpServer())
      .post('/api/restaurant-verifications')
      .send({ token: 'new-verification' })
      .expect(200, { kind: 'success' });
    const cookie = verification.headers['set-cookie'][0].split(';')[0];

    await request(context.app.getHttpServer())
      .get('/api/restaurant-session')
      .set('Cookie', cookie)
      .expect(200, { kind: 'allowed' });
    await context.app.close();
  });

  it.each([
    ['no cookie', undefined],
    ['unsigned known slug', 'restaurant_session=demo-restaurant'],
    ['empty value', 'restaurant_session='],
    ['wrong secret', signedCookie(DEMO_ACCESS.staffSessionPayload, 'wrong-secret')],
  ])('rejects %s with the exact private response', async (_case, cookie) => {
    const context = await createTestContext();
    const submission = request(context.app.getHttpServer()).get(
      '/api/restaurant-session',
    );
    if (cookie !== undefined) {
      submission.set('Cookie', cookie);
    }

    const response = await submission.expect(401, unauthorizedBody);
    expect(response.headers['content-type']).toMatch(/^application\/json/);
    expect(Object.keys(response.body)).toEqual(['kind']);
    expect(response.headers['set-cookie']).toBeUndefined();
    expect(response.headers.location).toBeUndefined();
    expect(response.headers['www-authenticate']).toBeUndefined();
    await context.app.close();
  });

  it('rejects a one-character change to a valid signed value', async () => {
    const context = await createTestContext();
    const valid = signedCookie(DEMO_ACCESS.staffSessionPayload);
    const last = valid.at(-1) ?? '';
    const tampered = `${valid.slice(0, -1)}${last === 'a' ? 'b' : 'a'}`;

    await request(context.app.getHttpServer())
      .get('/api/restaurant-session')
      .set('Cookie', tampered)
      .expect(401, unauthorizedBody);
    await context.app.close();
  });

  it.each([
    ['unknown', 'unknown-restaurant'],
    ['case variant', 'Demo-Restaurant'],
    ['whitespace variant', ' demo-restaurant '],
    ['unverified', 'restaurant-unverified'],
  ])('rejects a valid signature for an %s slug', async (_case, slug) => {
    const context = await createTestContext();
    if (slug === 'restaurant-unverified') {
      createRestaurant(context.store, 'unverified', false);
    }

    await request(context.app.getHttpServer())
      .get('/api/restaurant-session')
      .set('Cookie', signedCookie(slug))
      .expect(401, unauthorizedBody);
    await context.app.close();
  });

  it('performs a fresh lookup and denies an unverified or removed restaurant between requests', async () => {
    const context = await createTestContext();
    const cookie = signedCookie(DEMO_ACCESS.staffSessionPayload);

    await request(context.app.getHttpServer())
      .get('/api/restaurant-session')
      .set('Cookie', cookie)
      .expect(200, { kind: 'allowed' });
    context.store.updateRestaurant(1, { verified: false });
    await request(context.app.getHttpServer())
      .get('/api/restaurant-session')
      .set('Cookie', cookie)
      .expect(401, unauthorizedBody);
    context.store.updateRestaurant(1, { verified: true });
    context.store.reset();
    await request(context.app.getHttpServer())
      .get('/api/restaurant-session')
      .set('Cookie', cookie)
      .expect(401, unauthorizedBody);
    await context.app.close();
  });

  it('sanitizes store and signed-cookie accessor failures without refreshing a cookie', async () => {
    const context = await createTestContext();
    jest.spyOn(context.store, 'findRestaurantBySlug').mockImplementationOnce(() => {
      throw new Error('private store account detail');
    });
    const storeFailure = await request(context.app.getHttpServer())
      .get('/api/restaurant-session')
      .set('Cookie', signedCookie(DEMO_ACCESS.staffSessionPayload))
      .expect(500, unexpectedBody);
    const accessorFailure = await request(context.app.getHttpServer())
      .get('/api/restaurant-session')
      .set('x-simulate-cookie-access-failure', 'true')
      .expect(500, unexpectedBody);

    for (const response of [storeFailure, accessorFailure]) {
      expect(response.headers['set-cookie']).toBeUndefined();
      expect(JSON.stringify(response.body)).not.toMatch(/private|store|account|cookie/i);
    }
    await context.app.close();
  });

  it('leaves signup and verification public when no session exists', async () => {
    const context = await createTestContext();

    await request(context.app.getHttpServer())
      .post('/api/restaurants')
      .send({})
      .expect(400, { kind: 'validation', message: 'Invalid request.' });
    await request(context.app.getHttpServer())
      .post('/api/restaurant-verifications')
      .send({})
      .expect(400, { kind: 'invalid-or-used-token' });
    await context.app.close();
  });
});

describe('reusable restaurant session guard', () => {
  it('attaches exactly one frozen minimal principal and cannot mutate the store through it', async () => {
    const context = await createTestContext();

    const response = await request(context.app.getHttpServer())
      .get('/guard-probe')
      .set('Cookie', signedCookie(DEMO_ACCESS.staffSessionPayload))
      .expect(200);

    expect(response.body).toEqual({
      principal: { id: 1, name: 'Demo Restaurant', slug: 'demo-restaurant' },
      keys: ['id', 'name', 'slug'],
      frozen: true,
      mutationRejected: true,
    });
    expect(context.store.findRestaurantById(1)?.name).toBe('Demo Restaurant');
    expect(protectedHandlerCalls).toBe(1);
    await context.app.close();
  });

  it('does not run a protected handler for unauthorized or unexpected requests', async () => {
    const context = await createTestContext();

    await request(context.app.getHttpServer())
      .get('/guard-probe')
      .expect(401, unauthorizedBody);
    jest.spyOn(context.store, 'findRestaurantBySlug').mockImplementationOnce(() => {
      throw new Error('private lookup');
    });
    await request(context.app.getHttpServer())
      .get('/guard-probe')
      .set('Cookie', signedCookie(DEMO_ACCESS.staffSessionPayload))
      .expect(500, unexpectedBody);

    expect(protectedHandlerCalls).toBe(0);
    await context.app.close();
  });

  it('keeps concurrent principals isolated by request', async () => {
    const context = await createTestContext();
    const first = createRestaurant(context.store, 'first', true);
    const second = createRestaurant(context.store, 'second', true);

    const responses = await Promise.all([
      request(context.app.getHttpServer())
        .get('/guard-probe')
        .set('Cookie', signedCookie(first.slug)),
      request(context.app.getHttpServer())
        .get('/guard-probe')
        .set('Cookie', signedCookie(second.slug)),
    ]);

    expect(responses.map((response) => response.body.principal)).toEqual([
      { id: first.id, name: first.name, slug: first.slug },
      { id: second.id, name: second.name, slug: second.slug },
    ]);
    expect(protectedHandlerCalls).toBe(2);
    await context.app.close();
  });

  it.each([
    ['missing signedCookies', {}],
    ['undefined signedCookies', { signedCookies: undefined }],
    ['null signedCookies', { signedCookies: null }],
    ['missing property', { signedCookies: Object.create(null) as object }],
    ['undefined value', { signedCookies: { restaurant_session: undefined } }],
    ['null value', { signedCookies: { restaurant_session: null } }],
    ['tamper sentinel', { signedCookies: { restaurant_session: false } }],
    ['empty string', { signedCookies: { restaurant_session: '' } }],
    ['non-string', { signedCookies: { restaurant_session: 42 } }],
    [
      'inherited property',
      { signedCookies: Object.create({ restaurant_session: 'demo-restaurant' }) as object },
    ],
    [
      'unsigned fallback only',
      { cookies: { restaurant_session: 'demo-restaurant' } },
    ],
  ])('fails closed for %s', (_case, incomingRequest) => {
    const store = { findRestaurantBySlug: jest.fn() } as unknown as InMemoryStore;
    const guard = new RestaurantSessionGuard(store);
    const context = {
      switchToHttp: () => ({ getRequest: () => incomingRequest }),
    } as ExecutionContext;

    expect(() => guard.canActivate(context)).toThrow();
    expect(store.findRestaurantBySlug).not.toHaveBeenCalled();
  });

  it('accepts a null-prototype own signed-cookie property', () => {
    const signedCookies = Object.create(null) as Record<string, unknown>;
    signedCookies.restaurant_session = 'demo-restaurant';
    const incomingRequest = { signedCookies };
    const store = {
      findRestaurantBySlug: jest.fn(() => ({
        id: 1,
        name: 'Demo Restaurant',
        slug: 'demo-restaurant',
        verified: true,
      })),
    } as unknown as InMemoryStore;
    const guard = new RestaurantSessionGuard(store);
    const context = {
      switchToHttp: () => ({ getRequest: () => incomingRequest }),
    } as ExecutionContext;

    expect(guard.canActivate(context)).toBe(true);
    expect(store.findRestaurantBySlug).toHaveBeenCalledWith('demo-restaurant');
  });
});
