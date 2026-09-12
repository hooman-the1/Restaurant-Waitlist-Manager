import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ApiProperty } from '@nestjs/swagger';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import request = require('supertest');

import { configureApplication } from './application-configuration';
import { AppModule } from './app.module';
import {
  DashboardViewResponse,
  ResolvedDashboardEntryResponse,
} from './api-contract-models';
import {
  assertAuthoritativeContractFingerprint,
  assertOpenApiParity,
  createNestOpenApiDocument,
  loadAuthoritativeOpenApiDocument,
} from './api-documentation';
import { SystemClock } from './demo-data-seeder';
import { InMemoryStore } from './in-memory-store';
import { RestaurantSignupDto } from './request-dtos';

const expectedPaths = [
  '/api/dashboard',
  '/api/dashboard/waitlist-entries/{actionReference}',
  '/api/restaurant-session',
  '/api/restaurant-verifications',
  '/api/restaurants',
  '/api/restaurants/{restaurantSlug}',
  '/api/restaurants/{restaurantSlug}/waitlist-entries',
  '/api/waitlist-entries/{privateToken}',
  '/api/waitlist-entries/{privateToken}/cancellations',
];

const expectedOperationIds = [
  'signupRestaurant',
  'verifyRestaurant',
  'checkDashboardAccess',
  'lookupPublicRestaurant',
  'joinWaitlist',
  'loadPrivateStatus',
  'cancelWaitlistEntry',
  'loadDashboard',
  'resolveWaitlistEntry',
];

type JsonObject = Record<string, unknown>;

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function collectOperationIds(document: JsonObject): string[] {
  return Object.values(document.paths as JsonObject).flatMap((pathItem) =>
    Object.values(pathItem as JsonObject).map(
      (operation) => (operation as JsonObject).operationId as string,
    ),
  );
}

describe('API documentation', () => {
  let app: INestApplication;
  let store: InMemoryStore;
  let clock: { now: jest.Mock<Date, []> };

  beforeAll(async () => {
    clock = { now: jest.fn(() => new Date(2026, 8, 12, 12)) };
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(SystemClock)
      .useValue(clock)
      .compile();
    app = module.createNestApplication();
    configureApplication(app, {
      port: 8000,
      secretKey: 'documentation-test-secret',
      frontendOrigin: 'http://localhost:4200',
    });
    await app.init();
    store = module.get(InMemoryStore);
    clock.now.mockClear();
  });

  afterAll(async () => app.close());

  it.each([
    ['/docs', 'Swagger UI'],
    ['/redoc', 'API Reference'],
  ])('serves the public canonical %s HTML referencing /openapi.json', async (path, marker) => {
    const response = await request(app.getHttpServer())
      .get(path)
      .set('Cookie', 'restaurant_session=s%3Ainvalid.invalid')
      .expect(200);

    expect(response.headers['content-type']).toMatch(/^text\/html/);
    expect(response.text).toContain(marker);
    expect(response.text).toContain('/openapi.json');
    expect(response.headers.location).toBeUndefined();
    expect(response.headers['set-cookie']).toBeUndefined();
    expect(response.text).not.toContain('documentation-test-secret');
  });

  it('serves every local UI asset referenced by the documentation pages', async () => {
    const pages = await Promise.all(
      ['/docs', '/redoc'].map((path) => request(app.getHttpServer()).get(path)),
    );
    const assetPaths = pages.flatMap((page) =>
      [...page.text.matchAll(/(?:src|href)="((?:\/|\.\/)[^"?#]+)[^\"]*"/g)]
        .map((match) =>
          match[1].startsWith('./') ? `/${match[1].slice(2)}` : match[1],
        )
        .filter((path) => path !== '/openapi.json'),
    );

    expect(assetPaths.length).toBeGreaterThan(0);
    expect(new Set(assetPaths).size).toBe(assetPaths.length);
    for (const assetPath of assetPaths) {
      await request(app.getHttpServer()).get(assetPath).expect(200);
    }
    const swaggerInitializer = await request(app.getHttpServer())
      .get('/docs/swagger-ui-init.js')
      .expect(200);
    expect(swaggerInitializer.text).toContain('/openapi.json');
    expect(swaggerInitializer.text).not.toContain('/api/restaurants');
  });

  it('returns the parsed root YAML exactly as JSON and excludes infrastructure paths', async () => {
    const expected = loadAuthoritativeOpenApiDocument();
    const response = await request(app.getHttpServer())
      .get('/openapi.json')
      .expect('Content-Type', /application\/json/)
      .expect(200);

    expect(response.body).toEqual(expected);
    expect(response.body.openapi).toBe('3.1.0');
    expect(Object.keys(response.body.paths).sort()).toEqual(expectedPaths);
    expect(collectOperationIds(response.body).sort()).toEqual(
      expectedOperationIds.sort(),
    );
    expect(Object.keys(response.body.paths)).not.toEqual(
      expect.arrayContaining(['/docs', '/redoc', '/openapi.json']),
    );
  });

  it('does not mount prefixed aliases and sanitizes unknown documentation routes', async () => {
    for (const path of [
      '/api/docs',
      '/api/redoc',
      '/api/reference',
      '/api/docs-json',
      '/docs/private-source-map',
      '/redoc/environment',
    ]) {
      const response = await request(app.getHttpServer())
        .get(path)
        .expect(404, { kind: 'not-found' });
      expect(JSON.stringify(response.headers)).not.toMatch(
        /source-map|node_modules|documentation-test-secret/i,
      );
    }
  });

  it('keeps concurrent documentation reads deterministic and store-neutral', async () => {
    const before = {
      restaurant: store.findRestaurantById(1),
      active: store.listActiveWaitlistEntries(1),
      resolved: store.listResolvedWaitlistEntries(1),
    };

    const responses = await Promise.all([
      request(app.getHttpServer()).get('/openapi.json'),
      request(app.getHttpServer()).get('/openapi.json'),
      request(app.getHttpServer()).get('/docs'),
      request(app.getHttpServer()).get('/redoc'),
    ]);

    expect(responses.map((response) => response.status)).toEqual([
      200,
      200,
      200,
      200,
    ]);
    expect(responses[0].body).toEqual(responses[1].body);
    expect(clock.now).not.toHaveBeenCalled();
    expect({
      restaurant: store.findRestaurantById(1),
      active: store.listActiveWaitlistEntries(1),
      resolved: store.listResolvedWaitlistEntries(1),
    }).toEqual(before);
  });

  it('generates Nest metadata semantically identical to the authoritative YAML', () => {
    const generated = createNestOpenApiDocument(app);
    const authoritative = loadAuthoritativeOpenApiDocument();

    expect(() => assertOpenApiParity(generated, authoritative)).not.toThrow();
    expect(generated).toEqual(authoritative);
  });

  it('rejects drift in implementation-side ApiProperty metadata', () => {
    ApiProperty({
      example: 'correct-horse',
      format: 'password',
      minLength: 7,
      writeOnly: true,
    })(RestaurantSignupDto.prototype, 'password');

    try {
      expect(() => createNestOpenApiDocument(app)).toThrow(
        'OpenAPI contract drift at /components/schemas/RestaurantSignupInput/properties/password/minLength',
      );
    } finally {
      ApiProperty({
        example: 'correct-horse',
        format: 'password',
        minLength: 8,
        writeOnly: true,
      })(RestaurantSignupDto.prototype, 'password');
    }
  });

  it('rejects drift in implementation-side response DTO metadata', () => {
    ApiProperty({
      type: () => [ResolvedDashboardEntryResponse],
      description: 'Wrong response description.',
    })(DashboardViewResponse.prototype, 'resolvedToday');

    try {
      expect(() => createNestOpenApiDocument(app)).toThrow(
        'OpenAPI contract drift at /components/schemas/DashboardView/properties/resolvedToday/description',
      );
    } finally {
      ApiProperty({
        type: () => [ResolvedDashboardEntryResponse],
        description: 'Entries resolved during the current server-local day.',
      })(DashboardViewResponse.prototype, 'resolvedToday');
    }
  });

  it.each([
    ['operation', (document: JsonObject) => {
      delete ((document.paths as JsonObject)['/api/restaurants'] as JsonObject).post;
    }],
    ['cookie security', (document: JsonObject) => {
      (((document.components as JsonObject).securitySchemes as JsonObject)
        .restaurantSession as JsonObject).name = 'wrong_cookie';
    }],
    ['opaque parameter', (document: JsonObject) => {
      (((document.components as JsonObject).parameters as JsonObject)
        .PrivateToken as JsonObject).required = false;
    }],
    ['response', (document: JsonObject) => {
      delete (((document.paths as JsonObject)[
        '/api/restaurant-verifications'
      ] as JsonObject).post as JsonObject).responses;
    }],
    ['request constraint', (document: JsonObject) => {
      (((((document.components as JsonObject).schemas as JsonObject)
        .RestaurantSignupInput as JsonObject).properties as JsonObject)
        .password as JsonObject).minLength = 7;
    }],
    ['response field', (document: JsonObject) => {
      delete (((((document.components as JsonObject).schemas as JsonObject)
        .DashboardView as JsonObject).properties as JsonObject)
        .resolvedToday as JsonObject).items;
    }],
    ['enum', (document: JsonObject) => {
      (((document.components as JsonObject).schemas as JsonObject)
        .FinalStatus as JsonObject).enum = ['seated'];
    }],
    ['constant', (document: JsonObject) => {
      (((((document.components as JsonObject).schemas as JsonObject)
        .Success as JsonObject).properties as JsonObject).kind as JsonObject)
        .const = 'wrong';
    }],
    ['privacy boundary', (document: JsonObject) => {
      (((document.components as JsonObject).securitySchemes as JsonObject)
        .restaurantSession as JsonObject).type = 'http';
    }],
  ])('reports a useful material difference for a mutated %s', (_name, mutate) => {
    const generated = createNestOpenApiDocument(app);
    const authoritative = loadAuthoritativeOpenApiDocument();
    mutate(generated as unknown as JsonObject);

    expect(() => assertOpenApiParity(generated, authoritative)).toThrow(
      /OpenAPI contract drift at \//,
    );
  });

  it('detects an authoritative YAML-side mutation at its material JSON pointer', () => {
    const authoritative = clone(loadAuthoritativeOpenApiDocument()) as unknown as JsonObject;
    (((((authoritative.components as JsonObject).schemas as JsonObject)
      .JoinWaitlistInput as JsonObject).properties as JsonObject)
      .partySize as JsonObject).maximum = 31;

    expect(() =>
      assertAuthoritativeContractFingerprint(authoritative),
    ).toThrow(
      'OpenAPI contract drift at /components/schemas/JoinWaitlistInput',
    );
  });

  it('resolves the root contract rather than a generated backend artifact', () => {
    const rootYaml = readFileSync(resolve(__dirname, '../../openapi.yaml'), 'utf8');
    expect(rootYaml).toContain('openapi: 3.1.0');
    expect(loadAuthoritativeOpenApiDocument()).toEqual(
      expect.objectContaining({ openapi: '3.1.0' }),
    );
  });
});
