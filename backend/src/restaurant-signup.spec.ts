import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { verify } from 'argon2';
import request = require('supertest');

import { configureApplication } from './application-configuration';
import { AppModule } from './app.module';
import { SystemClock } from './demo-data-seeder';
import { InMemoryStore } from './in-memory-store';
import {
  FrontendOrigin,
  PasswordHasher,
  RestaurantSignupController,
  VerificationTokenSource,
  VerificationUrlLogger,
} from './restaurant-signup';

const fixedNow = new Date(2026, 8, 12, 16, 0, 0);
const conflictBody = {
  kind: 'validation',
  message: 'A restaurant with that name or email already exists.',
};
const unexpectedBody = {
  kind: 'unexpected',
  message: 'Something went wrong. Please try again.',
};

interface TestContext {
  app: INestApplication;
  store: InMemoryStore;
  controller: RestaurantSignupController;
  hasher: { hash: jest.Mock<Promise<string>, [string]> };
  tokenSource: { generate: jest.Mock<string, []> };
  clock: { now: jest.Mock<Date, []> };
  logger: { log: jest.Mock<void, [string]> };
}

async function createTestContext(overrides?: {
  hash?: (password: string) => Promise<string>;
  generate?: () => string;
  now?: () => Date;
  log?: (line: string) => void;
  frontendOrigin?: string;
}): Promise<TestContext> {
  const hasher = { hash: jest.fn(overrides?.hash ?? (async (value) => `hash:${value}`)) };
  const tokenSource = {
    generate: jest.fn(overrides?.generate ?? (() => '10000000-0000-4000-8000-000000000001')),
  };
  const clock = { now: jest.fn(overrides?.now ?? (() => new Date(fixedNow))) };
  const logger = { log: jest.fn(overrides?.log ?? (() => undefined)) };
  const module = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(PasswordHasher)
    .useValue(hasher)
    .overrideProvider(VerificationTokenSource)
    .useValue(tokenSource)
    .overrideProvider(FrontendOrigin)
    .useValue({ get: () => overrides?.frontendOrigin ?? 'http://localhost:4200' })
    .overrideProvider(VerificationUrlLogger)
    .useValue(logger)
    .overrideProvider(SystemClock)
    .useValue(clock)
    .compile();

  const app = module.createNestApplication();
  configureApplication(app, {
    port: 8000,
    secretKey: 'test-secret',
    frontendOrigin: 'http://localhost:4200',
  });
  await app.init();

  return {
    app,
    store: module.get(InMemoryStore),
    controller: module.get(RestaurantSignupController),
    hasher,
    tokenSource,
    clock,
    logger,
  };
}

const validSignup = {
  restaurantName: 'New Restaurant',
  email: 'owner@example.com',
  password: 'password',
};

describe('POST /api/restaurants', () => {
  it('creates an unverified normalized account and returns only success', async () => {
    const context = await createTestContext();

    const response = await request(context.app.getHttpServer())
      .post('/api/restaurants')
      .send({
        restaurantName: '  The\t  Garden  ',
        email: ' Owner@Example.COM ',
        password: 'password',
      })
      .expect(201, { kind: 'success' });

    expect(response.headers['content-type']).toMatch(/^application\/json/);
    expect(response.headers['set-cookie']).toBeUndefined();
    expect(response.headers.location).toBeUndefined();
    expect(Object.keys(response.body)).toEqual(['kind']);
    expect(context.store.findRestaurantBySlug('the-garden')).toEqual({
      id: 2,
      name: 'The Garden',
      normalizedName: 'the garden',
      email: 'Owner@Example.COM',
      normalizedEmail: 'owner@example.com',
      passwordHash: 'hash:password',
      slug: 'the-garden',
      verified: false,
      createdAt: fixedNow,
    });
    expect(context.store.findVerificationToken('10000000-0000-4000-8000-000000000001')).toEqual({
      token: '10000000-0000-4000-8000-000000000001',
      restaurantId: 2,
    });
    expect(context.hasher.hash).toHaveBeenCalledWith('password');
    expect(context.clock.now).toHaveBeenCalledTimes(2);
    expect(context.logger.log).toHaveBeenCalledWith(
      'Restaurant verification URL: http://localhost:4200/verify/10000000-0000-4000-8000-000000000001',
    );

    await context.app.close();
  });

  it.each([
    [{}, { kind: 'validation', message: 'Invalid request.' }],
    [{ ...validSignup, password: 'short' }, { kind: 'validation', message: 'Invalid request.' }],
    [{ ...validSignup, email: 1 }, { kind: 'validation', message: 'Invalid request.' }],
    [{ ...validSignup, extra: true }, { kind: 'validation', message: 'Invalid request.' }],
  ])('rejects transport-invalid input without mutation or logging', async (body, expected) => {
    const context = await createTestContext();

    await request(context.app.getHttpServer())
      .post('/api/restaurants')
      .send(body)
      .expect(400, expected);

    expect(context.store.findRestaurantById(2)).toBeUndefined();
    expect(context.hasher.hash).not.toHaveBeenCalled();
    expect(context.logger.log).not.toHaveBeenCalled();
    await context.app.close();
  });

  it.each([
    ['   \t ', 'owner@example.com', 'password', 'Restaurant name is required.'],
    ['***', 'owner@example.com', 'password', 'Restaurant name must contain a letter or number.'],
    ['Valid', 'owner @example.com', 'password', 'Enter a valid email address.'],
    ['Valid', 'owner@@example.com', 'password', 'Enter a valid email address.'],
    ['Valid', '@example.com', 'password', 'Enter a valid email address.'],
    ['Valid', 'owner@', 'password', 'Enter a valid email address.'],
    ['Valid', 'owner@localhost', 'password', 'Enter a valid email address.'],
    ['Valid', 'owner@example..com', 'password', 'Enter a valid email address.'],
  ])('returns the deterministic business validation result', async (name, email, password, message) => {
    const context = await createTestContext();

    await request(context.app.getHttpServer())
      .post('/api/restaurants')
      .send({ restaurantName: name, email, password })
      .expect(400, { kind: 'validation', message });

    expect(context.store.findRestaurantById(2)).toBeUndefined();
    expect(context.hasher.hash).not.toHaveBeenCalled();
    expect(context.logger.log).not.toHaveBeenCalled();
    await context.app.close();
  });

  it('applies explicit email and code-point password business guards at the unit seam', async () => {
    const context = await createTestContext();

    await expect(
      context.controller.signup({
        restaurantName: 'Valid',
        email: '',
        password: 'password',
      }),
    ).rejects.toMatchObject({ message: 'Enter a valid email address.' });
    await expect(
      context.controller.signup({
        restaurantName: 'Valid',
        email: 'owner@example.com',
        password: '\u{1f600}'.repeat(7),
      }),
    ).rejects.toMatchObject({
      message: 'Password must be at least 8 characters.',
    });
    expect(context.store.findRestaurantById(2)).toBeUndefined();
    expect(context.hasher.hash).not.toHaveBeenCalled();
    await context.app.close();
  });

  it('accepts plus-tagged email and exactly eight Unicode code points', async () => {
    const context = await createTestContext();
    const password = '\u{1f600}'.repeat(8);

    await request(context.app.getHttpServer())
      .post('/api/restaurants')
      .send({
        restaurantName: 'Unicode Password',
        email: ' Owner+Host@Example.co.uk ',
        password,
      })
      .expect(201, { kind: 'success' });

    expect(context.store.findRestaurantBySlug('unicode-password')?.email).toBe(
      'Owner+Host@Example.co.uk',
    );
    expect(context.hasher.hash).toHaveBeenCalledWith(password);
    await context.app.close();
  });

  it('checks name before email before password without mutation', async () => {
    const context = await createTestContext();

    await request(context.app.getHttpServer())
      .post('/api/restaurants')
      .send({ restaurantName: '   ', email: 'invalid', password: 'password' })
      .expect(400, { kind: 'validation', message: 'Restaurant name is required.' });

    expect(context.store.findRestaurantById(2)).toBeUndefined();
    expect(context.hasher.hash).not.toHaveBeenCalled();
    await context.app.close();
  });

  it('rejects seeded and newly created name, email, and slug conflicts identically', async () => {
    const context = await createTestContext();

    await request(context.app.getHttpServer())
      .post('/api/restaurants')
      .send({ ...validSignup, restaurantName: ' demo   restaurant ' })
      .expect(409, conflictBody);
    await request(context.app.getHttpServer())
      .post('/api/restaurants')
      .send({ ...validSignup, restaurantName: 'A & B', email: 'first@example.com' })
      .expect(201);
    await request(context.app.getHttpServer())
      .post('/api/restaurants')
      .send({ ...validSignup, restaurantName: 'A---B', email: 'second@example.com' })
      .expect(409, conflictBody);
    await request(context.app.getHttpServer())
      .post('/api/restaurants')
      .send({ ...validSignup, restaurantName: 'Different', email: ' FIRST@EXAMPLE.COM ' })
      .expect(409, conflictBody);

    expect(context.store.findRestaurantById(3)).toBeUndefined();
    expect(context.logger.log).toHaveBeenCalledTimes(1);
    await context.app.close();
  });

  it('retries token collisions and persists only the first unused token', async () => {
    const tokens = ['existing', 'existing', 'unused'];
    const context = await createTestContext({ generate: () => tokens.shift() ?? 'unexpected' });
    context.store.createVerificationToken('existing', 1);

    await request(context.app.getHttpServer())
      .post('/api/restaurants')
      .send(validSignup)
      .expect(201, { kind: 'success' });

    expect(context.tokenSource.generate).toHaveBeenCalledTimes(3);
    expect(context.store.findVerificationToken('existing')?.restaurantId).toBe(1);
    expect(context.store.findVerificationToken('unused')?.restaurantId).toBe(2);
    await context.app.close();
  });

  it('exhausts three token collisions with an atomic sanitized failure', async () => {
    const context = await createTestContext({ generate: () => 'existing' });
    context.store.createVerificationToken('existing', 1);

    await request(context.app.getHttpServer())
      .post('/api/restaurants')
      .send(validSignup)
      .expect(500, unexpectedBody);

    expect(context.tokenSource.generate).toHaveBeenCalledTimes(3);
    expect(context.store.findRestaurantById(2)).toBeUndefined();
    expect(context.store.findVerificationToken('existing')?.restaurantId).toBe(1);
    expect(context.clock.now).toHaveBeenCalledTimes(1);
    expect(context.logger.log).not.toHaveBeenCalled();
    await context.app.close();
  });

  it('allows exactly one of two concurrent normalized duplicates', async () => {
    let releaseHashing: (() => void) | undefined;
    const hashingGate = new Promise<void>((resolve) => {
      releaseHashing = resolve;
    });
    let calls = 0;
    const context = await createTestContext({
      hash: async () => {
        calls += 1;
        if (calls === 2) releaseHashing?.();
        await hashingGate;
        return `hash-${calls}`;
      },
      generate: (() => {
        let token = 0;
        return () => `token-${++token}`;
      })(),
    });

    const responses = await Promise.all([
      request(context.app.getHttpServer()).post('/api/restaurants').send(validSignup),
      request(context.app.getHttpServer()).post('/api/restaurants').send({
        ...validSignup,
        restaurantName: ' new   restaurant ',
        email: 'different@example.com',
      }),
    ]);

    expect(responses.map((response) => response.status).sort()).toEqual([201, 409]);
    expect(responses.find((response) => response.status === 409)?.body).toEqual(conflictBody);
    expect(context.store.findRestaurantById(2)?.normalizedName).toBe('new restaurant');
    expect(context.store.findRestaurantById(3)).toBeUndefined();
    expect(context.logger.log).toHaveBeenCalledTimes(1);
    await context.app.close();
  });

  it.each(['hasher', 'token', 'clock', 'store', 'logger'])(
    'rolls back and sanitizes a %s adapter failure',
    async (failure) => {
      const context = await createTestContext({
        hash: failure === 'hasher' ? async () => Promise.reject(new Error('private hash')) : undefined,
        generate: failure === 'token' ? () => { throw new Error('private token'); } : undefined,
        log: failure === 'logger' ? () => { throw new Error('private logger'); } : undefined,
      });
      if (failure === 'clock') {
        context.clock.now.mockImplementationOnce(() => {
          throw new Error('private clock');
        });
      }
      if (failure === 'store') {
        jest.spyOn(context.store, 'commitRestaurantSignup').mockImplementationOnce(() => {
          throw new Error('private store');
        });
      }

      const response = await request(context.app.getHttpServer())
        .post('/api/restaurants')
        .send(validSignup)
        .expect(500, unexpectedBody);

      expect(JSON.stringify(response.headers) + JSON.stringify(response.body)).not.toMatch(
        /password|private|hash:|owner@example|internal/i,
      );
      expect(context.store.findRestaurantById(2)).toBeUndefined();
      expect(context.store.findVerificationToken('10000000-0000-4000-8000-000000000001')).toBeUndefined();
      await context.app.close();
    },
  );

  it('restores the restaurant sequence when post-commit logging fails', async () => {
    const context = await createTestContext({
      log: () => {
        throw new Error('private logger');
      },
    });

    await request(context.app.getHttpServer())
      .post('/api/restaurants')
      .send(validSignup)
      .expect(500, unexpectedBody);

    context.logger.log.mockImplementation(() => undefined);
    await request(context.app.getHttpServer())
      .post('/api/restaurants')
      .send(validSignup)
      .expect(201, { kind: 'success' });

    expect(context.store.findRestaurantById(2)?.email).toBe('owner@example.com');
    expect(context.store.findRestaurantById(3)).toBeUndefined();
    await context.app.close();
  });

  it('URL-encodes the token, avoids a double slash, and logs no private input', async () => {
    const context = await createTestContext({
      generate: () => 'token/with ?',
      frontendOrigin: 'http://localhost:4200/',
    });

    await request(context.app.getHttpServer())
      .post('/api/restaurants')
      .send({ ...validSignup, password: 'do-not-log-this' })
      .expect(201, { kind: 'success' });

    expect(context.logger.log).toHaveBeenCalledWith(
      'Restaurant verification URL: http://localhost:4200/verify/token%2Fwith%20%3F',
    );
    const line = context.logger.log.mock.calls[0][0];
    expect(line).not.toMatch(/owner@example|do-not-log-this|hash:|\b2\b/);
    await context.app.close();
  });
});

describe('PasswordHasher', () => {
  it('uses salted Argon2id hashes that verify against the plaintext', async () => {
    const hasher = new PasswordHasher();

    const first = await hasher.hash('same-password');
    const second = await hasher.hash('same-password');

    expect(first).toMatch(/^\$argon2id\$/);
    expect(second).toMatch(/^\$argon2id\$/);
    expect(first).not.toBe('same-password');
    expect(second).not.toBe(first);
    await expect(verify(first, 'same-password')).resolves.toBe(true);
    await expect(verify(second, 'same-password')).resolves.toBe(true);
  });
});
