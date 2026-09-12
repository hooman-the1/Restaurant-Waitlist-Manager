import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { sign } from 'cookie-signature';
import request = require('supertest');

import { configureApplication } from './application-configuration';
import { AppModule } from './app.module';
import { SystemClock } from './demo-data-seeder';
import { ActiveWaitlistEntryRecord, InMemoryStore } from './in-memory-store';
import {
  ActionReferenceSource,
  PrivateStatusTokenSource,
} from './public-waitlist-join';

const fixedNow = new Date(2026, 8, 12, 21, 0, 0);
const privateOne = '10000000-0000-4000-8000-000000000001';
const actionOne = '20000000-0000-4000-8000-000000000002';
const privateTwo = '30000000-0000-4000-8000-000000000003';
const actionTwo = '40000000-0000-4000-8000-000000000004';
const joinDataUuid = '50000000-0000-4000-8000-000000000005';
const duplicateBody = {
  kind: 'duplicate-phone',
  message: 'This phone number is already on the waitlist.',
};
const unexpectedBody = {
  kind: 'unexpected',
  message: 'Something went wrong. Please try again.',
};

interface TestContext {
  app: INestApplication;
  store: InMemoryStore;
  privateSource: { generate: jest.Mock<string, []> };
  actionSource: { generate: jest.Mock<string, []> };
  clock: { now: jest.Mock<Date, []> };
}

async function createTestContext(overrides?: {
  privateToken?: () => string;
  actionReference?: () => string;
  now?: () => Date;
}): Promise<TestContext> {
  const privateSource = {
    generate: jest.fn(overrides?.privateToken ?? (() => privateOne)),
  };
  const actionSource = {
    generate: jest.fn(overrides?.actionReference ?? (() => actionOne)),
  };
  const clock = {
    now: jest.fn(overrides?.now ?? (() => new Date(fixedNow))),
  };
  const module = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(PrivateStatusTokenSource)
    .useValue(privateSource)
    .overrideProvider(ActionReferenceSource)
    .useValue(actionSource)
    .overrideProvider(SystemClock)
    .useValue(clock)
    .compile();
  const app = module.createNestApplication();
  configureApplication(app, {
    port: 8000,
    secretKey: 'join-test-secret',
    frontendOrigin: 'http://localhost:4200',
  });
  await app.init();

  return {
    app,
    store: module.get(InMemoryStore),
    privateSource,
    actionSource,
    clock,
  };
}

const validJoin = {
  customerName: 'Taylor Reed',
  phone: '(555) 010-4000',
  partySize: 4,
};

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
    createdAt: new Date(fixedNow),
  });
}

function createEntry(
  store: InMemoryStore,
  restaurantId: number,
  suffix: string,
  status: 'active' | 'seated' | 'cancelled' | 'no-show' = 'active',
) {
  const base = {
    restaurantId,
    customerName: `Customer ${suffix}`,
    phone: '555-010-9000',
    normalizedPhone: '5550109000',
    partySize: 2,
    privateStatusToken: `private-${suffix}`,
    actionReference: `action-${suffix}`,
    joinedAt: new Date(fixedNow),
  };
  return status === 'active'
    ? store.createWaitlistEntry({ ...base, status })
    : store.createWaitlistEntry({
        ...base,
        status,
        resolvedAt: new Date(fixedNow),
      });
}

function expectNeutralHeaders(response: request.Response): void {
  expect(response.headers['set-cookie']).toBeUndefined();
  expect(response.headers.location).toBeUndefined();
  expect(response.headers['www-authenticate']).toBeUndefined();
  expect(response.headers['cache-control']).toBeUndefined();
}

describe('POST /api/restaurants/:restaurantSlug/waitlist-entries', () => {
  it('preserves display values, appends FIFO, and returns only the private capability', async () => {
    const context = await createTestContext();
    const response = await request(context.app.getHttpServer())
      .post('/api/restaurants/demo-restaurant/waitlist-entries')
      .send({
        customerName: '  Élodie  王  ',
        phone: '+1 (555) 010-4000',
        partySize: 30,
      })
      .expect(201, { kind: 'success', privateStatusToken: privateOne });

    expect(response.headers['content-type']).toMatch(/^application\/json/);
    expect(Object.keys(response.body).sort()).toEqual([
      'kind',
      'privateStatusToken',
    ]);
    expect(response.body.privateStatusToken).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    expectNeutralHeaders(response);
    const stored =
      context.store.findWaitlistEntryByPrivateStatusToken(privateOne);
    expect(stored?.actionReference).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    expect(stored?.actionReference).not.toBe(stored?.privateStatusToken);
    expect(stored).toEqual({
      id: 4,
      restaurantId: 1,
      customerName: '  Élodie  王  ',
      phone: '+1 (555) 010-4000',
      normalizedPhone: '+15550104000',
      partySize: 30,
      privateStatusToken: privateOne,
      actionReference: actionOne,
      joinedAt: fixedNow,
      status: 'active',
    });
    expect(
      context.store.listActiveWaitlistEntries(1).map((entry) => entry.id),
    ).toEqual([1, 2, 4]);
    expect(JSON.stringify(response.body)).not.toMatch(
      /action|customer|phone|party|position|restaurant|joined|internal|normalized/i,
    );
    expect(context.clock.now).toHaveBeenCalledTimes(3);
    await context.app.close();
  });

  it.each([
    ['non-object', 'primitive'],
    ['missing property', { customerName: 'A', phone: '1' }],
    ['extra property', { ...validJoin, extra: true }],
    ['wrong name type', { ...validJoin, customerName: 2 }],
    ['empty name', { ...validJoin, customerName: '' }],
    ['empty phone', { ...validJoin, phone: '' }],
    ['numeric-string party', { ...validJoin, partySize: '4' }],
    ['decimal party', { ...validJoin, partySize: 1.5 }],
    ['party below range', { ...validJoin, partySize: 0 }],
    ['party above range', { ...validJoin, partySize: 31 }],
  ])(
    'rejects a %s at the transport boundary without mutation',
    async (_case, body) => {
      const context = await createTestContext();
      const before = context.store.listActiveWaitlistEntries(1);
      const submission = request(context.app.getHttpServer()).post(
        '/api/restaurants/demo-restaurant/waitlist-entries',
      );
      if (typeof body === 'string') {
        submission
          .set('Content-Type', 'application/json')
          .send(JSON.stringify(body));
      } else {
        submission.send(body);
      }
      const response = await submission.expect(400, {
        kind: 'validation',
        message: 'Invalid request.',
      });

      expect(context.store.listActiveWaitlistEntries(1)).toEqual(before);
      expect(context.privateSource.generate).not.toHaveBeenCalled();
      expectNeutralHeaders(response);
      await context.app.close();
    },
  );

  it.each(['unknown', 'Demo-Restaurant', '%20demo-restaurant%20'])(
    'uses exact slug lookup before business validation for %s',
    async (slug) => {
      const context = await createTestContext();
      await request(context.app.getHttpServer())
        .post(`/api/restaurants/${slug}/waitlist-entries`)
        .send({ customerName: '   ', phone: 'letters', partySize: 1 })
        .expect(404, { kind: 'not-found' });
      expect(context.privateSource.generate).not.toHaveBeenCalled();
      await context.app.close();
    },
  );

  it('checks whitespace-only name before phone and preserves duplicate names', async () => {
    const context = await createTestContext();
    await request(context.app.getHttpServer())
      .post('/api/restaurants/demo-restaurant/waitlist-entries')
      .send({ customerName: ' \t ', phone: 'letters', partySize: 1 })
      .expect(400, {
        kind: 'validation',
        message: 'Customer name is required.',
      });

    await request(context.app.getHttpServer())
      .post('/api/restaurants/demo-restaurant/waitlist-entries')
      .send({ customerName: 'Morgan Lee', phone: '5550104000', partySize: 1 })
      .expect(201);
    expect(
      context.store.listActiveWaitlistEntries(1).at(-1)?.customerName,
    ).toBe('Morgan Lee');
    await context.app.close();
  });

  it.each([
    ['formatting only', ' ()- '],
    ['plus only', '+'],
    ['misplaced plus', '1+2'],
    ['letters', '555CALL'],
    ['dot', '555.010'],
    ['tab', '555\t010'],
    ['Unicode space', '555\u00a0010'],
    ['Unicode dash', '555\u2013010'],
    ['punctuation', '555/010'],
  ])('rejects %s phone while preserving state', async (_case, phone) => {
    const context = await createTestContext();
    await request(context.app.getHttpServer())
      .post('/api/restaurants/demo-restaurant/waitlist-entries')
      .send({ ...validJoin, phone })
      .expect(400, {
        kind: 'validation',
        message: 'Enter a valid phone number.',
      });
    expect(context.privateSource.generate).not.toHaveBeenCalled();
    await context.app.close();
  });

  it.each([
    ['formatted', '(555) 010-4000', '5550104000'],
    ['leading plus formatted', '+1 (555) 010-4000', '+15550104000'],
    ['leading plus compact', '+15550104000', '+15550104000'],
    ['compact without plus', '15550104000', '15550104000'],
  ])(
    'stores %s phone with exact display and comparison values',
    async (_case, phone, normalizedPhone) => {
      const context = await createTestContext();
      await request(context.app.getHttpServer())
        .post('/api/restaurants/demo-restaurant/waitlist-entries')
        .send({ ...validJoin, phone })
        .expect(201);
      const entry =
        context.store.findWaitlistEntryByPrivateStatusToken(privateOne);
      expect(entry?.phone).toBe(phone);
      expect(entry?.normalizedPhone).toBe(normalizedPhone);
      await context.app.close();
    },
  );

  it.each([1, 30])(
    'accepts party-size boundary %i without changing FIFO priority',
    async (partySize) => {
      const context = await createTestContext();
      await request(context.app.getHttpServer())
        .post('/api/restaurants/demo-restaurant/waitlist-entries')
        .send({ ...validJoin, partySize })
        .expect(201);
      expect(context.store.listActiveWaitlistEntries(1).at(-1)?.partySize).toBe(
        partySize,
      );
      await context.app.close();
    },
  );

  it('rejects an active normalized-phone duplicate without exposing its capability', async () => {
    const context = await createTestContext();
    const before = context.store.listActiveWaitlistEntries(1);
    const response = await request(context.app.getHttpServer())
      .post('/api/restaurants/demo-restaurant/waitlist-entries')
      .send({
        customerName: 'Duplicate Name Allowed',
        phone: '5550101000',
        partySize: 1,
      })
      .expect(409, duplicateBody);

    expect(Object.keys(response.body).sort()).toEqual(['kind', 'message']);
    expect(JSON.stringify(response.body)).not.toMatch(
      /8f4d6e2b|Morgan|reference|token/i,
    );
    expect(context.store.listActiveWaitlistEntries(1)).toEqual(before);
    expect(context.privateSource.generate).not.toHaveBeenCalled();
    await context.app.close();
  });

  it('scopes active-phone uniqueness to one restaurant', async () => {
    const context = await createTestContext();
    const other = createRestaurant(context.store, 'other');
    await request(context.app.getHttpServer())
      .post(`/api/restaurants/${other.slug}/waitlist-entries`)
      .send({ ...validJoin, phone: '(555) 010-1000' })
      .expect(201);
    expect(context.store.listActiveWaitlistEntries(other.id)).toHaveLength(1);
    await context.app.close();
  });

  it('accepts joins for an unverified restaurant', async () => {
    const context = await createTestContext();
    const restaurant = createRestaurant(context.store, 'unverified', false);

    await request(context.app.getHttpServer())
      .post(`/api/restaurants/${restaurant.slug}/waitlist-entries`)
      .send(validJoin)
      .expect(201, { kind: 'success', privateStatusToken: privateOne });
    expect(context.store.listActiveWaitlistEntries(restaurant.id)).toHaveLength(
      1,
    );
    await context.app.close();
  });

  it.each(['seated', 'cancelled', 'no-show'] as const)(
    'allows rejoining after a %s entry',
    async (status) => {
      const context = await createTestContext();
      const restaurant = createRestaurant(context.store, status);
      createEntry(context.store, restaurant.id, status, status);
      await request(context.app.getHttpServer())
        .post(`/api/restaurants/${restaurant.slug}/waitlist-entries`)
        .send({ ...validJoin, phone: '(555) 010-9000' })
        .expect(201);
      expect(
        context.store.listActiveWaitlistEntries(restaurant.id),
      ).toHaveLength(1);
      expect(
        context.store.listResolvedWaitlistEntries(restaurant.id),
      ).toHaveLength(1);
      await context.app.close();
    },
  );

  it('retries a complete capability pair on cross-namespace collisions', async () => {
    const privateValues = [actionOne, privateTwo, privateTwo];
    const actionValues = [actionTwo, privateOne, actionTwo];
    const context = await createTestContext({
      privateToken: () => privateValues.shift() ?? privateTwo,
      actionReference: () => actionValues.shift() ?? actionTwo,
    });
    context.store.createWaitlistEntry({
      restaurantId: 1,
      customerName: 'Capability Seed',
      phone: '5550108888',
      normalizedPhone: '5550108888',
      partySize: 2,
      privateStatusToken: privateOne,
      actionReference: actionOne,
      joinedAt: fixedNow,
      status: 'active',
    });

    await request(context.app.getHttpServer())
      .post('/api/restaurants/demo-restaurant/waitlist-entries')
      .send(validJoin)
      .expect(201, { kind: 'success', privateStatusToken: privateTwo });
    expect(context.privateSource.generate).toHaveBeenCalledTimes(3);
    expect(context.actionSource.generate).toHaveBeenCalledTimes(3);
    expect(
      context.store.findWaitlistEntryByActionReference(actionTwo)
        ?.privateStatusToken,
    ).toBe(privateTwo);
    await context.app.close();
  });

  it('exhausts three invalid/colliding pairs atomically without consuming sequence', async () => {
    const context = await createTestContext({
      privateToken: () => 'not-a-uuid',
      actionReference: () => privateOne,
    });
    const before = context.store.listActiveWaitlistEntries(1);
    const response = await request(context.app.getHttpServer())
      .post('/api/restaurants/demo-restaurant/waitlist-entries')
      .send(validJoin)
      .expect(500, unexpectedBody);

    expect(context.privateSource.generate).toHaveBeenCalledTimes(3);
    expect(context.actionSource.generate).toHaveBeenCalledTimes(3);
    expect(context.clock.now).toHaveBeenCalledTimes(2);
    expect(context.store.listActiveWaitlistEntries(1)).toEqual(before);
    expectNeutralHeaders(response);

    context.privateSource.generate.mockImplementation(() => privateOne);
    context.actionSource.generate.mockImplementation(() => actionOne);
    await request(context.app.getHttpServer())
      .post('/api/restaurants/demo-restaurant/waitlist-entries')
      .send(validJoin)
      .expect(201);
    expect(
      context.store.findWaitlistEntryByPrivateStatusToken(privateOne)?.id,
    ).toBe(4);
    await context.app.close();
  });

  it('retries the complete pair when private and action capabilities are equal', async () => {
    const privateValues = [privateOne, privateTwo];
    const actionValues = [privateOne, actionTwo];
    const context = await createTestContext({
      privateToken: () => privateValues.shift() ?? privateTwo,
      actionReference: () => actionValues.shift() ?? actionTwo,
    });

    await request(context.app.getHttpServer())
      .post('/api/restaurants/demo-restaurant/waitlist-entries')
      .send(validJoin)
      .expect(201, { kind: 'success', privateStatusToken: privateTwo });
    expect(context.privateSource.generate).toHaveBeenCalledTimes(2);
    expect(context.actionSource.generate).toHaveBeenCalledTimes(2);
    await context.app.close();
  });

  it.each([
    ['restaurant slug', 'private'],
    ['restaurant slug', 'action'],
    ['customer name', 'private'],
    ['customer name', 'action'],
    ['display phone', 'private'],
    ['display phone', 'action'],
  ] as const)(
    'retries a fresh pair when the %s equals the generated %s capability',
    async (dataField, capability) => {
      const privateValues =
        capability === 'private'
          ? [joinDataUuid, privateTwo]
          : [privateOne, privateTwo];
      const actionValues =
        capability === 'action'
          ? [joinDataUuid, actionTwo]
          : [actionOne, actionTwo];
      const context = await createTestContext({
        privateToken: () => privateValues.shift() ?? privateTwo,
        actionReference: () => actionValues.shift() ?? actionTwo,
      });
      const restaurant =
        dataField === 'restaurant slug'
          ? context.store.createRestaurant({
              name: 'UUID Slug Restaurant',
              normalizedName: 'uuid slug restaurant',
              email: 'uuid-slug@example.com',
              normalizedEmail: 'uuid-slug@example.com',
              passwordHash: 'hash-uuid-slug',
              slug: joinDataUuid,
              verified: true,
              createdAt: fixedNow,
            })
          : context.store.findRestaurantBySlug('demo-restaurant');
      const body = {
        ...validJoin,
        customerName:
          dataField === 'customer name' ? joinDataUuid : validJoin.customerName,
        phone: dataField === 'display phone' ? joinDataUuid : validJoin.phone,
      };

      await request(context.app.getHttpServer())
        .post(`/api/restaurants/${restaurant?.slug}/waitlist-entries`)
        .send(body)
        .expect(201, { kind: 'success', privateStatusToken: privateTwo });

      expect(context.privateSource.generate).toHaveBeenCalledTimes(2);
      expect(context.actionSource.generate).toHaveBeenCalledTimes(2);
      expect(
        context.store.findWaitlistEntryByPrivateStatusToken(privateTwo),
      ).toMatchObject({
        customerName: body.customerName,
        phone: body.phone,
        actionReference: actionTwo,
      });
      await context.app.close();
    },
  );

  it.each(['restaurant slug', 'customer name', 'display phone'] as const)(
    'exhausts repeated %s collisions without mutation or sequence consumption',
    async (dataField) => {
      const context = await createTestContext({
        privateToken: () => joinDataUuid,
        actionReference: () => actionOne,
      });
      const restaurant =
        dataField === 'restaurant slug'
          ? context.store.createRestaurant({
              name: 'UUID Slug Restaurant',
              normalizedName: 'uuid slug restaurant',
              email: 'uuid-slug@example.com',
              normalizedEmail: 'uuid-slug@example.com',
              passwordHash: 'hash-uuid-slug',
              slug: joinDataUuid,
              verified: true,
              createdAt: fixedNow,
            })
          : context.store.findRestaurantBySlug('demo-restaurant');
      const body = {
        ...validJoin,
        customerName:
          dataField === 'customer name' ? joinDataUuid : validJoin.customerName,
        phone: dataField === 'display phone' ? joinDataUuid : validJoin.phone,
      };
      const before = context.store.listActiveWaitlistEntries(
        restaurant?.id ?? 0,
      );

      await request(context.app.getHttpServer())
        .post(`/api/restaurants/${restaurant?.slug}/waitlist-entries`)
        .send(body)
        .expect(500, unexpectedBody);

      expect(context.privateSource.generate).toHaveBeenCalledTimes(3);
      expect(context.actionSource.generate).toHaveBeenCalledTimes(3);
      expect(
        context.store.listActiveWaitlistEntries(restaurant?.id ?? 0),
      ).toEqual(before);

      context.privateSource.generate.mockImplementation(() => privateTwo);
      context.actionSource.generate.mockImplementation(() => actionTwo);
      await request(context.app.getHttpServer())
        .post(`/api/restaurants/${restaurant?.slug}/waitlist-entries`)
        .send(body)
        .expect(201);
      expect(
        context.store.findWaitlistEntryByPrivateStatusToken(privateTwo)?.id,
      ).toBe(4);
      await context.app.close();
    },
  );

  it('retries a fresh pair when the atomic final capability recheck collides', async () => {
    const privateValues = [privateOne, privateTwo];
    const actionValues = [actionOne, actionTwo];
    const context = await createTestContext({
      privateToken: () => privateValues.shift() ?? privateTwo,
      actionReference: () => actionValues.shift() ?? actionTwo,
    });
    jest
      .spyOn(context.store, 'hasWaitlistCapabilityCollision')
      .mockReturnValueOnce(false)
      .mockReturnValueOnce(true)
      .mockReturnValue(false);

    await request(context.app.getHttpServer())
      .post('/api/restaurants/demo-restaurant/waitlist-entries')
      .send(validJoin)
      .expect(201, { kind: 'success', privateStatusToken: privateTwo });
    expect(context.privateSource.generate).toHaveBeenCalledTimes(2);
    expect(
      context.store.findWaitlistEntryByPrivateStatusToken(privateOne),
    ).toBeUndefined();
    await context.app.close();
  });

  it('allows only one of two concurrent normalized-phone duplicates', async () => {
    let pair = 0;
    const privateValues = [privateOne, privateTwo];
    const actionValues = [actionOne, actionTwo];
    const context = await createTestContext({
      privateToken: () => privateValues[pair] ?? privateTwo,
      actionReference: () => actionValues[pair++] ?? actionTwo,
    });

    const responses = await Promise.all([
      request(context.app.getHttpServer())
        .post('/api/restaurants/demo-restaurant/waitlist-entries')
        .send(validJoin),
      request(context.app.getHttpServer())
        .post('/api/restaurants/demo-restaurant/waitlist-entries')
        .send({ ...validJoin, phone: '5550104000' }),
    ]);

    expect(responses.map((response) => response.status).sort()).toEqual([
      201, 409,
    ]);
    expect(
      context.store
        .listActiveWaitlistEntries(1)
        .filter((entry) => entry.normalizedPhone === '5550104000'),
    ).toHaveLength(1);
    expect(
      responses.filter((response) => response.body.privateStatusToken),
    ).toHaveLength(1);
    await context.app.close();
  });

  it('allows concurrent joins with different phones and restaurants without cross-contamination', async () => {
    const privateValues = [privateOne, privateTwo];
    const actionValues = [actionOne, actionTwo];
    let privateIndex = 0;
    let actionIndex = 0;
    const context = await createTestContext({
      privateToken: () => privateValues[privateIndex++] ?? privateTwo,
      actionReference: () => actionValues[actionIndex++] ?? actionTwo,
    });
    const other = createRestaurant(context.store, 'parallel');

    const responses = await Promise.all([
      request(context.app.getHttpServer())
        .post('/api/restaurants/demo-restaurant/waitlist-entries')
        .send(validJoin),
      request(context.app.getHttpServer())
        .post(`/api/restaurants/${other.slug}/waitlist-entries`)
        .send({ ...validJoin, phone: '5550105000' }),
    ]);

    expect(responses.map((response) => response.status)).toEqual([201, 201]);
    expect(
      context.store.listActiveWaitlistEntries(1).at(-1)?.normalizedPhone,
    ).toBe('5550104000');
    expect(
      context.store.listActiveWaitlistEntries(other.id).at(-1)?.normalizedPhone,
    ).toBe('5550105000');
    await context.app.close();
  });

  it.each(['private generator', 'action generator', 'clock', 'store'])(
    'sanitizes a %s failure without mutation or sequencing changes',
    async (failure) => {
      const context = await createTestContext();
      if (failure === 'private generator') {
        context.privateSource.generate.mockImplementationOnce(() => {
          throw new Error('private generator');
        });
      }
      if (failure === 'action generator') {
        context.actionSource.generate.mockImplementationOnce(() => {
          throw new Error('private generator');
        });
      }
      if (failure === 'clock') {
        context.clock.now.mockImplementationOnce(() => {
          throw new Error('private clock');
        });
      }
      if (failure === 'store') {
        jest
          .spyOn(context.store, 'commitWaitlistJoin')
          .mockImplementationOnce(() => {
            throw new Error('private store');
          });
      }
      const before = context.store.listActiveWaitlistEntries(1);

      const response = await request(context.app.getHttpServer())
        .post('/api/restaurants/demo-restaurant/waitlist-entries')
        .send(validJoin)
        .expect(500, unexpectedBody);

      expect(JSON.stringify(response.body)).not.toMatch(
        /private|generator|clock|store|Taylor|555/i,
      );
      expect(context.store.listActiveWaitlistEntries(1)).toEqual(before);
      expectNeutralHeaders(response);

      await request(context.app.getHttpServer())
        .post('/api/restaurants/demo-restaurant/waitlist-entries')
        .send(validJoin)
        .expect(201, { kind: 'success', privateStatusToken: privateOne });
      expect(
        context.store.findWaitlistEntryByPrivateStatusToken(privateOne)?.id,
      ).toBe(4);
      await context.app.close();
    },
  );

  it.each([
    [
      'valid',
      `restaurant_session=${encodeURIComponent(`s:${sign('demo-restaurant', 'join-test-secret')}`)}`,
    ],
    ['unsigned', 'restaurant_session=demo-restaurant'],
    [
      'invalid signature',
      `restaurant_session=${encodeURIComponent(`s:${sign('demo-restaurant', 'wrong-secret')}`)}`,
    ],
    ['tampered', 'restaurant_session=s%3Atampered'],
  ])(
    'ignores a %s restaurant cookie and does not log',
    async (_case, cookie) => {
      const context = await createTestContext();
      const log = jest
        .spyOn(console, 'log')
        .mockImplementation(() => undefined);
      const response = await request(context.app.getHttpServer())
        .post('/api/restaurants/demo-restaurant/waitlist-entries')
        .set('Cookie', cookie)
        .send(validJoin)
        .expect(201);
      expectNeutralHeaders(response);
      expect(log).not.toHaveBeenCalled();
      log.mockRestore();
      await context.app.close();
    },
  );
});

describe('atomic waitlist join store operation', () => {
  it('performs final restaurant, active-phone, and cross-capability rechecks', () => {
    const store = new InMemoryStore();
    const restaurant = createRestaurant(store, 'final-checks');
    createEntry(store, restaurant.id, 'existing');
    const input = {
      customerName: 'Customer',
      phone: '555-010-9000',
      normalizedPhone: '5550109000',
      partySize: 1,
      privateStatusToken: privateOne,
      actionReference: actionOne,
      joinedAt: fixedNow,
    };

    expect(store.commitWaitlistJoin('missing', input)).toEqual({
      kind: 'not-found',
    });
    expect(store.commitWaitlistJoin(restaurant.slug, input)).toEqual({
      kind: 'duplicate-phone',
    });
    const differentPhone = { ...input, normalizedPhone: '5550107777' };
    store.createWaitlistEntry({
      restaurantId: restaurant.id,
      customerName: 'Capability Owner',
      phone: '5550106666',
      normalizedPhone: '5550106666',
      partySize: 1,
      privateStatusToken: actionTwo,
      actionReference: privateTwo,
      joinedAt: fixedNow,
      status: 'active',
    });
    expect(
      store.commitWaitlistJoin(restaurant.slug, {
        ...differentPhone,
        privateStatusToken: privateTwo,
      }),
    ).toEqual({ kind: 'capability-collision' });
  });

  it('rolls back a partial map insertion and preserves the entry sequence', () => {
    const store = new InMemoryStore();
    const restaurant = createRestaurant(store, 'rollback');
    const internals = store as unknown as {
      waitlistEntries: Map<number, ActiveWaitlistEntryRecord>;
    };
    const originalSet = internals.waitlistEntries.set.bind(
      internals.waitlistEntries,
    );
    jest
      .spyOn(internals.waitlistEntries, 'set')
      .mockImplementationOnce((id, entry) => {
        originalSet(id, entry);
        throw new Error('simulated insertion failure');
      });
    const input = {
      customerName: 'Customer',
      phone: '123',
      normalizedPhone: '123',
      partySize: 1,
      privateStatusToken: privateOne,
      actionReference: actionOne,
      joinedAt: fixedNow,
    };

    expect(() => store.commitWaitlistJoin(restaurant.slug, input)).toThrow();
    expect(
      store.findWaitlistEntryByPrivateStatusToken(privateOne),
    ).toBeUndefined();
    expect(store.commitWaitlistJoin(restaurant.slug, input)).toMatchObject({
      kind: 'created',
      entry: { id: 1 },
    });
  });

  it.each([
    ['restaurant slug', 'private'],
    ['restaurant slug', 'action'],
    ['customer name', 'private'],
    ['customer name', 'action'],
    ['display phone', 'private'],
    ['display phone', 'action'],
  ] as const)(
    'atomically rejects a %s collision from the %s capability',
    (dataField, capability) => {
      const store = new InMemoryStore();
      const restaurant = store.createRestaurant({
        name: 'Atomic Restaurant',
        normalizedName: 'atomic restaurant',
        email: 'atomic@example.com',
        normalizedEmail: 'atomic@example.com',
        passwordHash: 'hash-atomic',
        slug: dataField === 'restaurant slug' ? joinDataUuid : 'atomic',
        verified: true,
        createdAt: fixedNow,
      });
      const input = {
        customerName: dataField === 'customer name' ? joinDataUuid : 'Customer',
        phone: dataField === 'display phone' ? joinDataUuid : '123',
        normalizedPhone:
          dataField === 'display phone'
            ? '50000000000040008000000000000005'
            : '123',
        partySize: 1,
        privateStatusToken:
          capability === 'private' ? joinDataUuid : privateOne,
        actionReference: capability === 'action' ? joinDataUuid : actionOne,
        joinedAt: fixedNow,
      };

      expect(store.commitWaitlistJoin(restaurant.slug, input)).toEqual({
        kind: 'capability-collision',
      });
      expect(store.listActiveWaitlistEntries(restaurant.id)).toEqual([]);
      expect(
        store.commitWaitlistJoin(restaurant.slug, {
          ...input,
          privateStatusToken: privateOne,
          actionReference: actionOne,
        }),
      ).toMatchObject({ kind: 'created', entry: { id: 1 } });
    },
  );
});
