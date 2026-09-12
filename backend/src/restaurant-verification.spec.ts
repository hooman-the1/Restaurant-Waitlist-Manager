import { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { unsign } from 'cookie-signature';
import request = require('supertest');

import { configureApplication } from './application-configuration';
import { AppModule } from './app.module';
import { DEMO_ACCESS } from './demo-data-seeder';
import {
  InMemoryStore,
  RestaurantRecord,
  VerificationTokenRecord,
} from './in-memory-store';
import { RestaurantSessionSigner } from './restaurant-verification';

const secret = 'verification-test-secret';
const invalidBody = { kind: 'invalid-or-used-token' };
const unexpectedBody = {
  kind: 'unexpected',
  message: 'Something went wrong. Please try again.',
};

interface TestContext {
  app: INestApplication;
  store: InMemoryStore;
  signer: { sign: jest.Mock<string, [string]> };
}

async function createTestContext(
  sign?: (slug: string) => string,
): Promise<TestContext> {
  const productionSigner = new RestaurantSessionSigner(
    new ConfigService({ SECRET_KEY: secret }),
  );
  const signer = {
    sign: jest.fn(sign ?? ((slug: string) => productionSigner.sign(slug))),
  };
  const module = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(RestaurantSessionSigner)
    .useValue(signer)
    .compile();
  const app = module.createNestApplication();
  configureApplication(app, {
    port: 8000,
    secretKey: secret,
    frontendOrigin: 'http://localhost:4200',
  });
  await app.init();

  return { app, store: module.get(InMemoryStore), signer };
}

function createUnverifiedRestaurant(
  store: InMemoryStore,
  suffix: string,
): RestaurantRecord {
  return store.createRestaurant({
    name: `Restaurant ${suffix}`,
    normalizedName: `restaurant ${suffix}`,
    email: `${suffix}@example.com`,
    normalizedEmail: `${suffix}@example.com`,
    passwordHash: `hash-${suffix}`,
    slug: `restaurant-${suffix}`,
    verified: false,
    createdAt: new Date(2026, 8, 12, 18, 0, 0),
  });
}

function cookieValue(setCookie: string): string {
  return decodeURIComponent(setCookie.split(';')[0].split('=')[1]);
}

describe('POST /api/restaurant-verifications', () => {
  it('atomically verifies the linked restaurant and returns one exact signed session cookie', async () => {
    const context = await createTestContext();
    const restaurant = createUnverifiedRestaurant(context.store, 'one');
    context.store.createVerificationToken('Exact-Token', restaurant.id);

    const response = await request(context.app.getHttpServer())
      .post('/api/restaurant-verifications')
      .send({ token: 'Exact-Token' })
      .expect(200, { kind: 'success' });

    expect(response.headers['content-type']).toMatch(/^application\/json/);
    expect(response.headers.location).toBeUndefined();
    expect(Object.keys(response.body)).toEqual(['kind']);
    expect(context.store.findRestaurantById(restaurant.id)?.verified).toBe(true);
    expect(context.store.findVerificationToken('Exact-Token')).toBeUndefined();
    expect(context.signer.sign).toHaveBeenCalledWith('restaurant-one');
    expect(response.headers['set-cookie']).toHaveLength(1);
    expect(response.headers['set-cookie'][0]).toMatch(
      /^restaurant_session=s%3Arestaurant-one\.[^;]+; Path=\/; HttpOnly; SameSite=Lax$/,
    );
    const signedCookie = cookieValue(response.headers['set-cookie'][0]);
    expect(unsign(signedCookie.slice(2), secret)).toBe('restaurant-one');
    expect(unsign(signedCookie.slice(2), 'different-secret')).toBe(false);
    await context.app.close();
  });

  it.each([
    ['missing body', undefined],
    ['missing token', {}],
    ['empty token', { token: '' }],
    ['extra property', { token: 'valid', extra: true }],
    ['wrong type', { token: 42 }],
  ])('maps a %s DTO failure to the route-specific result', async (_case, body) => {
    const context = await createTestContext();
    const restaurant = createUnverifiedRestaurant(context.store, 'dto');
    context.store.createVerificationToken('valid', restaurant.id);

    const submission = request(context.app.getHttpServer()).post(
      '/api/restaurant-verifications',
    );
    if (body !== undefined) {
      submission.send(body);
    }
    const response = await submission.expect(400, invalidBody);

    expect(response.headers['set-cookie']).toBeUndefined();
    expect(Object.keys(response.body)).toEqual(['kind']);
    expect(context.store.findRestaurantById(restaurant.id)?.verified).toBe(false);
    expect(context.store.findVerificationToken('valid')).toBeDefined();
    await context.app.close();
  });

  it('matches tokens exactly without rewriting and consumes only the exact token', async () => {
    const context = await createTestContext();
    const restaurant = createUnverifiedRestaurant(context.store, 'exact');
    context.store.createVerificationToken('Case-Sensitive', restaurant.id);

    for (const token of ['case-sensitive', ' Case-Sensitive', 'Case-Sensitive ']) {
      const response = await request(context.app.getHttpServer())
        .post('/api/restaurant-verifications')
        .send({ token })
        .expect(400, invalidBody);
      expect(response.headers['set-cookie']).toBeUndefined();
    }
    expect(context.store.findVerificationToken('Case-Sensitive')).toBeDefined();

    await request(context.app.getHttpServer())
      .post('/api/restaurant-verifications')
      .send({ token: 'Case-Sensitive' })
      .expect(200, { kind: 'success' });

    const reused = await request(context.app.getHttpServer())
      .post('/api/restaurant-verifications')
      .send({ token: 'Case-Sensitive' })
      .expect(400, invalidBody);
    expect(reused.headers['set-cookie']).toBeUndefined();
    expect(context.signer.sign).toHaveBeenCalledTimes(1);
    await context.app.close();
  });

  it.each(['unknown', 'missing-restaurant', 'already-verified'])(
    'rejects a %s token without affecting an unrelated valid pair',
    async (kind) => {
      const context = await createTestContext();
      const validRestaurant = createUnverifiedRestaurant(context.store, `valid-${kind}`);
      context.store.createVerificationToken('unrelated-valid', validRestaurant.id);
      if (kind === 'missing-restaurant') {
        context.store.createVerificationToken('subject', 9999);
      }
      if (kind === 'already-verified') {
        context.store.createVerificationToken('subject', 1);
      }

      const response = await request(context.app.getHttpServer())
        .post('/api/restaurant-verifications')
        .send({ token: kind === 'unknown' ? 'unknown' : 'subject' })
        .expect(400, invalidBody);

      expect(response.headers['set-cookie']).toBeUndefined();
      expect(context.store.findRestaurantById(validRestaurant.id)?.verified).toBe(false);
      expect(context.store.findVerificationToken('unrelated-valid')).toBeDefined();
      if (kind !== 'unknown') {
        expect(context.store.findVerificationToken('subject')).toBeUndefined();
      }
      await context.app.close();
    },
  );

  it('does not expire an unused token based on elapsed time', async () => {
    const context = await createTestContext();
    const restaurant = createUnverifiedRestaurant(context.store, 'old');
    context.store.createVerificationToken('old-token', restaurant.id);

    jest.useFakeTimers().setSystemTime(new Date(2099, 0, 1));
    await request(context.app.getHttpServer())
      .post('/api/restaurant-verifications')
      .send({ token: 'old-token' })
      .expect(200, { kind: 'success' });
    jest.useRealTimers();

    await context.app.close();
  });

  it('allows the same valid token to succeed only once under concurrent requests', async () => {
    const context = await createTestContext();
    const restaurant = createUnverifiedRestaurant(context.store, 'concurrent');
    context.store.createVerificationToken('one-use', restaurant.id);

    const responses = await Promise.all([
      request(context.app.getHttpServer())
        .post('/api/restaurant-verifications')
        .send({ token: 'one-use' }),
      request(context.app.getHttpServer())
        .post('/api/restaurant-verifications')
        .send({ token: 'one-use' }),
    ]);

    expect(responses.map((response) => response.status).sort()).toEqual([200, 400]);
    expect(responses.find((response) => response.status === 400)?.body).toEqual(invalidBody);
    expect(responses.flatMap((response) => response.headers['set-cookie'] ?? [])).toHaveLength(1);
    expect(context.signer.sign).toHaveBeenCalledTimes(1);
    expect(context.store.findRestaurantById(restaurant.id)?.verified).toBe(true);
    expect(context.store.findVerificationToken('one-use')).toBeUndefined();
    await context.app.close();
  });

  it('verifies two different tokens independently under concurrent requests', async () => {
    const context = await createTestContext();
    const first = createUnverifiedRestaurant(context.store, 'first');
    const second = createUnverifiedRestaurant(context.store, 'second');
    context.store.createVerificationToken('first-token', first.id);
    context.store.createVerificationToken('second-token', second.id);

    const responses = await Promise.all([
      request(context.app.getHttpServer())
        .post('/api/restaurant-verifications')
        .send({ token: 'first-token' }),
      request(context.app.getHttpServer())
        .post('/api/restaurant-verifications')
        .send({ token: 'second-token' }),
    ]);

    expect(responses.map((response) => response.status)).toEqual([200, 200]);
    expect(
      unsign(cookieValue(responses[0].headers['set-cookie'][0]).slice(2), secret),
    ).toBe('restaurant-first');
    expect(
      unsign(cookieValue(responses[1].headers['set-cookie'][0]).slice(2), secret),
    ).toBe('restaurant-second');
    expect(context.store.findRestaurantById(first.id)?.verified).toBe(true);
    expect(context.store.findRestaurantById(second.id)?.verified).toBe(true);
    await context.app.close();
  });

  it('signs before transition and preserves state when signing fails', async () => {
    const context = await createTestContext(() => {
      throw new Error('private signer secret');
    });
    const restaurant = createUnverifiedRestaurant(context.store, 'signer-failure');
    context.store.createVerificationToken('signer-token', restaurant.id);

    const response = await request(context.app.getHttpServer())
      .post('/api/restaurant-verifications')
      .send({ token: 'signer-token' })
      .expect(500, unexpectedBody);

    expect(response.headers['set-cookie']).toBeUndefined();
    expect(JSON.stringify(response.body)).not.toMatch(/private|secret|signer-token/i);
    expect(context.store.findRestaurantById(restaurant.id)?.verified).toBe(false);
    expect(context.store.findVerificationToken('signer-token')).toBeDefined();
    await context.app.close();
  });

  it('preserves state and sets no cookie when the atomic store fails', async () => {
    const context = await createTestContext();
    const restaurant = createUnverifiedRestaurant(context.store, 'store-failure');
    context.store.createVerificationToken('store-token', restaurant.id);
    jest.spyOn(context.store, 'verifyRestaurantWithToken').mockImplementationOnce(() => {
      throw new Error('private store detail');
    });

    const response = await request(context.app.getHttpServer())
      .post('/api/restaurant-verifications')
      .send({ token: 'store-token' })
      .expect(500, unexpectedBody);

    expect(response.headers['set-cookie']).toBeUndefined();
    expect(JSON.stringify(response.body)).not.toMatch(/private|store-token/i);
    expect(context.store.findRestaurantById(restaurant.id)?.verified).toBe(false);
    expect(context.store.findVerificationToken('store-token')).toBeDefined();
    await context.app.close();
  });

  it('replaces a supplied session cookie without using its value', async () => {
    const context = await createTestContext();
    const restaurant = createUnverifiedRestaurant(context.store, 'replacement');
    context.store.createVerificationToken('replacement-token', restaurant.id);

    const response = await request(context.app.getHttpServer())
      .post('/api/restaurant-verifications')
      .set('Cookie', 'restaurant_session=old-or-tampered')
      .send({ token: 'replacement-token' })
      .expect(200, { kind: 'success' });

    expect(response.headers['set-cookie']).toHaveLength(1);
    expect(response.headers['set-cookie'][0]).toMatch(/^restaurant_session=/);
    expect(response.headers['set-cookie'][0]).not.toContain('old-or-tampered');
    await context.app.close();
  });

  it('does not log or echo the submitted token or private restaurant fields', async () => {
    const log = jest.spyOn(console, 'log').mockImplementation(() => undefined);
    const context = await createTestContext();
    const restaurant = createUnverifiedRestaurant(context.store, 'privacy');
    context.store.createVerificationToken('do-not-log-token', restaurant.id);

    const response = await request(context.app.getHttpServer())
      .post('/api/restaurant-verifications')
      .send({ token: 'do-not-log-token' })
      .expect(200, { kind: 'success' });

    expect(JSON.stringify(response.body)).not.toMatch(
      /do-not-log-token|restaurant-privacy|privacy@example|hash-privacy/i,
    );
    expect(log).not.toHaveBeenCalled();
    log.mockRestore();
    await context.app.close();
  });
});

describe('atomic verification store operation', () => {
  it('restores the restaurant when token removal fails', () => {
    const store = new InMemoryStore();
    const restaurant = createUnverifiedRestaurant(store, 'rollback');
    store.createVerificationToken('rollback-token', restaurant.id);
    const internals = store as unknown as {
      verificationTokens: Map<string, VerificationTokenRecord>;
    };
    jest.spyOn(internals.verificationTokens, 'delete').mockImplementationOnce(() => {
      throw new Error('simulated delete failure');
    });

    expect(() => store.verifyRestaurantWithToken('rollback-token')).toThrow();
    expect(store.findRestaurantById(restaurant.id)?.verified).toBe(false);
    expect(store.findVerificationToken('rollback-token')).toBeDefined();
  });
});

describe('RestaurantSessionSigner', () => {
  it('uses the configured secret and cookie-parser-compatible signing', () => {
    const signer = new RestaurantSessionSigner(
      new ConfigService({ SECRET_KEY: secret }),
    );
    const signed = signer.sign(DEMO_ACCESS.staffSessionPayload);

    expect(signed).toMatch(/^s:/);
    expect(unsign(signed.slice(2), secret)).toBe(DEMO_ACCESS.staffSessionPayload);
    expect(unsign(signed.slice(2), 'different-secret')).toBe(false);
    const last = signed.at(-1) ?? '';
    const replacement = last === 'a' ? 'b' : 'a';
    expect(unsign(`${signed.slice(2, -1)}${replacement}`, secret)).toBe(false);
  });
});
