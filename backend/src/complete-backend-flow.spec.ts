import { INestApplication } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { sign, unsign } from 'cookie-signature';
import request = require('supertest');

import { configureApplication } from './application-configuration';
import { AppModule } from './app.module';
import { loadAuthoritativeOpenApiDocument } from './api-documentation';
import { SystemClock } from './demo-data-seeder';
import { InMemoryStore } from './in-memory-store';
import { ResolvedEntryCleanup } from './resolved-entry-cleanup';
import { VerificationUrlLogger } from './restaurant-signup';

const FRONTEND_ORIGIN = 'http://localhost:4200';
const SECRET_KEY = 'complete-flow-test-secret';
const DEMO_SLUG = 'demo-restaurant';
const MORGAN_TOKEN = '8f4d6e2b-1a73-4c95-b0e8-62d9f71a3c44';
const SAM_TOKEN = '7a2bfe87-27d4-4e13-8b0d-e7804c1e7421';
const ALEX_TOKEN = 'c2a7198e-6d40-4b53-9f81-37e5a6c04bd2';
const MORGAN_ACTION = '9c777a3d-b7ed-4c86-95ce-7f456a62ff11';
const SAM_ACTION = 'c5f2a8d4-6b31-47e0-9a25-2d8e6c714903';
const unexpectedBody = {
  kind: 'unexpected',
  message: 'Something went wrong. Please try again.',
};

interface TestContext {
  app: INestApplication;
  module: TestingModule;
  store: InMemoryStore;
  cleanup: ResolvedEntryCleanup;
  clock: { now: jest.Mock<Date, []>; set(value: Date): void };
  verificationLog: jest.Mock<void, [string]>;
}

function signedCookie(slug: string, secret = SECRET_KEY): string {
  return `restaurant_session=${encodeURIComponent(`s:${sign(slug, secret)}`)}`;
}

function cookieValue(setCookie: string): string {
  return decodeURIComponent(setCookie.split(';')[0].split('=')[1]);
}

function expectNoApplicationCache(response: request.Response): void {
  expect(response.headers['cache-control']).toBeUndefined();
}

async function createTestContext(options?: {
  logger?: (line: string) => void;
}): Promise<TestContext> {
  let currentTime = new Date(2026, 8, 12, 12, 0, 0);
  const clock = {
    now: jest.fn(() => new Date(currentTime)),
    set(value: Date) {
      currentTime = new Date(value);
    },
  };
  const verificationLog = jest.fn(options?.logger ?? (() => undefined));
  const module = await Test.createTestingModule({
    imports: [
      ConfigModule.forRoot({
        ignoreEnvFile: true,
        ignoreEnvVars: true,
        isGlobal: true,
        load: [
          () => ({
            PORT: '8000',
            SECRET_KEY,
            FRONTEND_ORIGIN,
          }),
        ],
      }),
      AppModule,
    ],
  })
    .overrideProvider(SystemClock)
    .useValue(clock)
    .overrideProvider(VerificationUrlLogger)
    .useValue({ log: verificationLog })
    .compile();
  const app = module.createNestApplication();
  configureApplication(app, {
    port: 8000,
    secretKey: SECRET_KEY,
    frontendOrigin: FRONTEND_ORIGIN,
  });
  await app.init();

  return {
    app,
    module,
    store: module.get(InMemoryStore),
    cleanup: module.get(ResolvedEntryCleanup),
    clock,
    verificationLog,
  };
}

describe('complete seeded backend flow', () => {
  let context: TestContext | undefined;
  let consoleLog: jest.SpyInstance;
  let consoleError: jest.SpyInstance;

  beforeEach(() => {
    consoleLog = jest.spyOn(console, 'log').mockImplementation(() => undefined);
    consoleError = jest
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
  });

  afterEach(async () => {
    await context?.app.close();
    consoleLog.mockRestore();
    consoleError.mockRestore();
  });

  it('boots a fresh deterministic seed with exact public, auth, CORS, cache, failure, and docs contracts', async () => {
    context = await createTestContext();
    const server = context.app.getHttpServer();
    const demoCookie = signedCookie(DEMO_SLUG);
    const demoSignedValue = decodeURIComponent(demoCookie.split('=')[1]);
    expect(unsign(demoSignedValue.slice(2), SECRET_KEY)).toBe(DEMO_SLUG);

    const publicRestaurant = await request(server)
      .get(`/api/restaurants/${DEMO_SLUG}`)
      .expect(200, {
        kind: 'success',
        restaurant: { restaurantName: 'Demo Restaurant' },
      });
    expectNoApplicationCache(publicRestaurant);

    await request(server)
      .get(`/api/waitlist-entries/${MORGAN_TOKEN}`)
      .expect('Cache-Control', 'no-store')
      .expect(200, {
        kind: 'active',
        restaurantName: 'Demo Restaurant',
        position: 1,
      });
    await request(server)
      .get(`/api/waitlist-entries/${SAM_TOKEN}`)
      .expect('Cache-Control', 'no-store')
      .expect(200, {
        kind: 'active',
        restaurantName: 'Demo Restaurant',
        position: 2,
      });
    await request(server)
      .get(`/api/waitlist-entries/${ALEX_TOKEN}`)
      .expect('Cache-Control', 'no-store')
      .expect(200, {
        kind: 'resolved',
        restaurantName: 'Demo Restaurant',
        finalStatus: 'seated',
      });

    await request(server)
      .get('/api/restaurant-session')
      .expect(401, { kind: 'unauthorized' });
    await request(server)
      .get('/api/restaurant-session')
      .set('Cookie', signedCookie(DEMO_SLUG, 'wrong-secret'))
      .expect(401, { kind: 'unauthorized' });
    const session = await request(server)
      .get('/api/restaurant-session')
      .set('Cookie', demoCookie)
      .expect(200, { kind: 'allowed' });
    expectNoApplicationCache(session);

    const dashboard = await request(server)
      .get('/api/dashboard')
      .set('Cookie', demoCookie)
      .expect('Cache-Control', 'no-store')
      .expect(200);
    expect(dashboard.body).toEqual({
      kind: 'success',
      dashboard: {
        restaurantName: 'Demo Restaurant',
        activeEntries: [
          {
            position: 1,
            customerName: 'Morgan Lee',
            phone: '(555) 010-1000',
            partySize: 6,
            actionReference: MORGAN_ACTION,
          },
          {
            position: 2,
            customerName: 'Sam Rivera',
            phone: '555-010-2000',
            partySize: 2,
            actionReference: SAM_ACTION,
          },
        ],
        resolvedToday: [
          { customerName: 'Alex Chen', partySize: 4, finalStatus: 'seated' },
        ],
      },
    });

    const unauthorizedDashboard = await request(server)
      .get('/api/dashboard')
      .expect('Cache-Control', 'no-store')
      .expect(401, { kind: 'unauthorized' });
    expect(Object.keys(unauthorizedDashboard.body)).toEqual(['kind']);
    await request(server)
      .get('/api/waitlist-entries/not-a-token')
      .expect('Cache-Control', 'no-store')
      .expect(404, { kind: 'not-found' });

    const privateRead = jest
      .spyOn(context.store, 'readPrivateWaitlistStatus')
      .mockImplementationOnce(() => {
        throw new Error('private status store detail');
      });
    await request(server)
      .get(`/api/waitlist-entries/${MORGAN_TOKEN}`)
      .expect('Cache-Control', 'no-store')
      .expect(500, unexpectedBody);
    privateRead.mockRestore();
    const dashboardRead = jest
      .spyOn(context.store, 'readDashboardSnapshot')
      .mockImplementationOnce(() => {
        throw new Error('dashboard store detail');
      });
    await request(server)
      .get('/api/dashboard')
      .set('Cookie', demoCookie)
      .expect('Cache-Control', 'no-store')
      .expect(500, unexpectedBody);
    dashboardRead.mockRestore();

    await request(server)
      .post('/api/restaurants')
      .set('Content-Type', 'application/json')
      .send('{"restaurantName":')
      .expect(400, { kind: 'validation', message: 'Invalid request.' });
    await request(server)
      .post('/api/restaurants')
      .send({
        restaurantName: 'Invalid Extra',
        email: 'extra@example.com',
        password: 'valid-password',
        undeclared: true,
      })
      .expect(400, { kind: 'validation', message: 'Invalid request.' });
    await request(server)
      .post('/api/restaurants')
      .send({
        restaurantName: 'Demo Restaurant',
        email: 'conflict@example.com',
        password: 'valid-password',
      })
      .expect(409, {
        kind: 'validation',
        message: 'A restaurant with that name or email already exists.',
      });
    await request(server)
      .post('/api/restaurant-verifications')
      .send({ token: 'invalid-token' })
      .expect(400, { kind: 'invalid-or-used-token' });
    await request(server)
      .get('/api/restaurants/not-found')
      .expect(404, { kind: 'not-found' });

    await request(server)
      .options('/api/dashboard')
      .set('Origin', FRONTEND_ORIGIN)
      .set('Access-Control-Request-Method', 'GET')
      .expect('Access-Control-Allow-Origin', FRONTEND_ORIGIN)
      .expect('Access-Control-Allow-Credentials', 'true')
      .expect(204);
    await request(server)
      .get(`/api/restaurants/${DEMO_SLUG}`)
      .set('Origin', FRONTEND_ORIGIN)
      .expect('Access-Control-Allow-Origin', FRONTEND_ORIGIN)
      .expect('Access-Control-Allow-Credentials', 'true')
      .expect(200);
    const protectedCors = await request(server)
      .get('/api/dashboard')
      .set('Origin', FRONTEND_ORIGIN)
      .set('Cookie', demoCookie)
      .expect('Access-Control-Allow-Origin', FRONTEND_ORIGIN)
      .expect('Access-Control-Allow-Credentials', 'true')
      .expect(200);
    expect(protectedCors.headers['cache-control']).toBe('no-store');
    const rejectedOrigin = await request(server)
      .get(`/api/restaurants/${DEMO_SLUG}`)
      .set('Origin', 'http://different.example')
      .expect(200);
    expect(
      rejectedOrigin.headers['access-control-allow-origin'],
    ).toBeUndefined();

    await request(server)
      .get('/docs')
      .expect('Content-Type', /^text\/html/)
      .expect(200);
    await request(server)
      .get('/redoc')
      .expect('Content-Type', /^text\/html/)
      .expect(200);
    const openApi = await request(server)
      .get('/openapi.json')
      .expect('Content-Type', /^application\/json/)
      .expect(200);
    expect(openApi.body).toEqual(loadAuthoritativeOpenApiDocument());

    expect(context.verificationLog).not.toHaveBeenCalled();
    expect(consoleLog).not.toHaveBeenCalled();
    expect(consoleError).not.toHaveBeenCalled();
  });

  it('completes signup, verification, queue transitions, cleanup, and a fresh restart without state leakage', async () => {
    context = await createTestContext();
    let server = context.app.getHttpServer();
    const agent = request.agent(server);
    const signupInput = {
      restaurantName: 'Night Owl',
      email: 'owner@night-owl.example',
      password: 'private-password',
    };

    const signup = await agent
      .post('/api/restaurants')
      .send(signupInput)
      .expect(201, { kind: 'success' });
    expect(Object.keys(signup.body)).toEqual(['kind']);
    expect(signup.headers['set-cookie']).toBeUndefined();
    expectNoApplicationCache(signup);
    expect(context.verificationLog).toHaveBeenCalledTimes(1);
    const deliveredUrl = context.verificationLog.mock.calls[0][0];
    expect(deliveredUrl).toMatch(
      /^Restaurant verification URL: http:\/\/localhost:4200\/verify\//,
    );
    const verificationToken = decodeURIComponent(
      deliveredUrl.slice(deliveredUrl.lastIndexOf('/') + 1),
    );

    await request(server)
      .get('/api/restaurant-session')
      .set('Cookie', signedCookie('night-owl'))
      .expect(401, { kind: 'unauthorized' });

    const verification = await agent
      .post('/api/restaurant-verifications')
      .send({ token: verificationToken })
      .expect(200, { kind: 'success' });
    expect(verification.headers['set-cookie']).toHaveLength(1);
    const setCookie = verification.headers['set-cookie'][0] as string;
    expect(setCookie).toMatch(
      /^restaurant_session=s%3Anight-owl\.[^;]+; Path=\/; HttpOnly; SameSite=Lax$/,
    );
    expect(setCookie).not.toMatch(/; (?:Secure|Expires|Max-Age)/i);
    const signedValue = cookieValue(setCookie);
    expect(unsign(signedValue.slice(2), SECRET_KEY)).toBe('night-owl');
    expect(unsign(signedValue.slice(2), 'different-secret')).toBe(false);
    expectNoApplicationCache(verification);

    const reusedToken = await request(server)
      .post('/api/restaurant-verifications')
      .send({ token: verificationToken })
      .expect(400, { kind: 'invalid-or-used-token' });
    expect(reusedToken.headers['set-cookie']).toBeUndefined();

    await agent.get('/api/restaurant-session').expect(200, { kind: 'allowed' });
    await agent
      .get('/api/dashboard')
      .expect('Cache-Control', 'no-store')
      .expect(200, {
        kind: 'success',
        dashboard: {
          restaurantName: 'Night Owl',
          activeEntries: [],
          resolvedToday: [],
        },
      });
    const lookup = await request(server)
      .get('/api/restaurants/night-owl')
      .expect(200, {
        kind: 'success',
        restaurant: { restaurantName: 'Night Owl' },
      });
    expect(JSON.stringify(lookup.body)).not.toMatch(
      /owner@|password|verification|restaurant_session|\"id\"/i,
    );

    const firstJoin = await request(server)
      .post('/api/restaurants/night-owl/waitlist-entries')
      .send({
        customerName: '  Casey Jones  ',
        phone: '(555) 010-4100',
        partySize: 3,
      })
      .expect(201);
    expect(Object.keys(firstJoin.body).sort()).toEqual([
      'kind',
      'privateStatusToken',
    ]);
    expect(firstJoin.body.kind).toBe('success');
    expectNoApplicationCache(firstJoin);
    const firstToken = firstJoin.body.privateStatusToken as string;

    let dashboard = await agent.get('/api/dashboard').expect(200);
    expect(dashboard.body.dashboard.activeEntries).toEqual([
      {
        position: 1,
        customerName: '  Casey Jones  ',
        phone: '(555) 010-4100',
        partySize: 3,
        actionReference: expect.any(String),
      },
    ]);
    const firstAction = dashboard.body.dashboard.activeEntries[0]
      .actionReference as string;
    const activeProjection = {
      kind: 'active',
      restaurantName: 'Night Owl',
      position: 1,
    };
    await request(server)
      .get(`/api/waitlist-entries/${firstToken}`)
      .expect('Cache-Control', 'no-store')
      .expect(200, activeProjection);
    await request(server)
      .get(`/api/waitlist-entries/${firstToken}`)
      .set('Cookie', signedCookie(DEMO_SLUG))
      .expect('Cache-Control', 'no-store')
      .expect(200, activeProjection);

    const secondJoin = await request(server)
      .post('/api/restaurants/night-owl/waitlist-entries')
      .send({ customerName: 'Riley Park', phone: '555-010-4200', partySize: 2 })
      .expect(201);
    const secondToken = secondJoin.body.privateStatusToken as string;
    await request(server)
      .post('/api/restaurants/night-owl/waitlist-entries')
      .send({ customerName: 'Duplicate', phone: '555 010 4100', partySize: 9 })
      .expect(409, {
        kind: 'duplicate-phone',
        message: 'This phone number is already on the waitlist.',
      });
    dashboard = await agent.get('/api/dashboard').expect(200);
    expect(dashboard.body.dashboard.activeEntries).toHaveLength(2);

    const cancellation = await request(server)
      .post(`/api/waitlist-entries/${firstToken}/cancellations`)
      .expect(200, { kind: 'cancelled' });
    expectNoApplicationCache(cancellation);
    await request(server)
      .get(`/api/waitlist-entries/${firstToken}`)
      .expect(200, {
        kind: 'resolved',
        restaurantName: 'Night Owl',
        finalStatus: 'cancelled',
      });
    dashboard = await agent.get('/api/dashboard').expect(200);
    expect(dashboard.body.dashboard.activeEntries[0]).toEqual(
      expect.objectContaining({ position: 1, customerName: 'Riley Park' }),
    );
    expect(dashboard.body.dashboard.resolvedToday).toContainEqual({
      customerName: '  Casey Jones  ',
      partySize: 3,
      finalStatus: 'cancelled',
    });

    const rejoin = await request(server)
      .post('/api/restaurants/night-owl/waitlist-entries')
      .send({
        customerName: 'Casey Again',
        phone: '555-010-4100',
        partySize: 4,
      })
      .expect(201);
    const rejoinToken = rejoin.body.privateStatusToken as string;
    dashboard = await agent.get('/api/dashboard').expect(200);
    expect(
      dashboard.body.dashboard.activeEntries.map(
        (entry: { position: number }) => entry.position,
      ),
    ).toEqual([1, 2]);
    const secondAction = dashboard.body.dashboard.activeEntries[0]
      .actionReference as string;
    const rejoinAction = dashboard.body.dashboard.activeEntries[1]
      .actionReference as string;

    await request(server)
      .patch(`/api/dashboard/waitlist-entries/${secondAction}`)
      .set('Cookie', signedCookie(DEMO_SLUG))
      .send({ resolution: 'seated' })
      .expect(404, { kind: 'not-found' });
    const seated = await agent
      .patch(`/api/dashboard/waitlist-entries/${secondAction}`)
      .send({ resolution: 'seated' })
      .expect(200, { kind: 'success' });
    expectNoApplicationCache(seated);
    await agent
      .patch(`/api/dashboard/waitlist-entries/${secondAction}`)
      .send({ resolution: 'no-show' })
      .expect(404, { kind: 'not-found' });
    await request(server)
      .get(`/api/waitlist-entries/${secondToken}`)
      .expect(200, {
        kind: 'resolved',
        restaurantName: 'Night Owl',
        finalStatus: 'seated',
      });

    await agent
      .patch(`/api/dashboard/waitlist-entries/${rejoinAction}`)
      .send({ resolution: 'no-show' })
      .expect(200, { kind: 'success' });
    await request(server)
      .get(`/api/waitlist-entries/${rejoinToken}`)
      .expect(200, {
        kind: 'resolved',
        restaurantName: 'Night Owl',
        finalStatus: 'no-show',
      });

    const activeJoin = await request(server)
      .post('/api/restaurants/night-owl/waitlist-entries')
      .send({
        customerName: 'Still Active',
        phone: '555-010-4300',
        partySize: 5,
      })
      .expect(201);
    context.clock.set(new Date(2026, 8, 13, 1, 0, 0));
    expect(context.cleanup.run()).toBe(4);
    for (const removedToken of [
      ALEX_TOKEN,
      firstToken,
      secondToken,
      rejoinToken,
    ]) {
      await request(server)
        .get(`/api/waitlist-entries/${removedToken}`)
        .expect('Cache-Control', 'no-store')
        .expect(404, { kind: 'not-found' });
    }
    for (const removedAction of [firstAction, secondAction, rejoinAction]) {
      await agent
        .patch(`/api/dashboard/waitlist-entries/${removedAction}`)
        .send({ resolution: 'seated' })
        .expect(404, { kind: 'not-found' });
    }
    dashboard = await agent.get('/api/dashboard').expect(200);
    expect(dashboard.body.dashboard.resolvedToday).toEqual([]);
    expect(dashboard.body.dashboard.activeEntries).toEqual([
      expect.objectContaining({
        position: 1,
        customerName: 'Still Active',
      }),
    ]);

    await context.app.close();
    context = await createTestContext();
    server = context.app.getHttpServer();
    await request(server)
      .get('/api/restaurants/night-owl')
      .expect(404, { kind: 'not-found' });
    await request(server)
      .get('/api/restaurant-session')
      .set('Cookie', `restaurant_session=${encodeURIComponent(signedValue)}`)
      .expect(401, { kind: 'unauthorized' });
    await request(server)
      .post('/api/restaurant-verifications')
      .send({ token: verificationToken })
      .expect(400, { kind: 'invalid-or-used-token' });
    await request(server)
      .get(`/api/waitlist-entries/${MORGAN_TOKEN}`)
      .expect(200, {
        kind: 'active',
        restaurantName: 'Demo Restaurant',
        position: 1,
      });
    expect(
      context.store.findWaitlistEntryByPrivateStatusToken(
        activeJoin.body.privateStatusToken,
      ),
    ).toBeUndefined();
    expect(context.verificationLog).not.toHaveBeenCalled();
    expect(consoleLog).not.toHaveBeenCalled();
    expect(consoleError).not.toHaveBeenCalled();
  });

  it('rolls back a forced delivery failure and returns a sanitized response without sensitive logs', async () => {
    const sensitiveValues = [
      'Rollback Bistro',
      'rollback@example.com',
      'do-not-expose-password',
      SECRET_KEY,
    ];
    context = await createTestContext({
      logger: () => {
        throw new Error('private delivery adapter detail');
      },
    });
    const response = await request(context.app.getHttpServer())
      .post('/api/restaurants')
      .send({
        restaurantName: sensitiveValues[0],
        email: sensitiveValues[1],
        password: sensitiveValues[2],
      })
      .expect(500, unexpectedBody);

    expect(response.body).toEqual(unexpectedBody);
    expect(
      JSON.stringify(response.headers) + JSON.stringify(response.body),
    ).not.toMatch(/stack|argon|cookie|token|reference|delivery adapter|store/i);
    for (const value of sensitiveValues) {
      expect(JSON.stringify(response.body)).not.toContain(value);
      expect(JSON.stringify(consoleLog.mock.calls)).not.toContain(value);
      expect(JSON.stringify(consoleError.mock.calls)).not.toContain(value);
    }
    expect(
      context.store.findRestaurantBySlug('rollback-bistro'),
    ).toBeUndefined();
    expect(context.store.findRestaurantById(2)).toBeUndefined();
    expect(consoleLog).not.toHaveBeenCalled();
    expect(consoleError).not.toHaveBeenCalled();
  });
});
