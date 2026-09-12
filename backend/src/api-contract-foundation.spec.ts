import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  INestApplication,
  Post,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request = require('supertest');

import { configureApplication } from './application-configuration';
import {
  duplicatePhoneFailure,
  invalidOrUsedTokenFailure,
  notFoundFailure,
  signupConflictFailure,
  unauthorizedFailure,
  unexpectedFailure,
  validationFailure,
} from './api-failures';
import {
  JoinWaitlistDto,
  RestaurantSignupDto,
  RestaurantVerificationDto,
  StaffResolutionDto,
} from './request-dtos';

@Controller('contract-test')
class ContractTestController {
  @Post('signup')
  signup(@Body() body: RestaurantSignupDto): RestaurantSignupDto {
    return body;
  }

  @Post('verification')
  verification(
    @Body() body: RestaurantVerificationDto,
  ): RestaurantVerificationDto {
    return body;
  }

  @Post('join')
  join(@Body() body: JoinWaitlistDto): JoinWaitlistDto {
    return body;
  }

  @Post('resolution')
  resolution(@Body() body: StaffResolutionDto): StaffResolutionDto {
    return body;
  }

  @Get('validation-failure')
  validationFailure(): never {
    throw validationFailure('Safe validation detail.');
  }

  @Get('signup-conflict')
  signupConflict(): never {
    throw signupConflictFailure('Safe conflict detail.');
  }

  @Get('duplicate-phone')
  duplicatePhone(): never {
    throw duplicatePhoneFailure();
  }

  @Get('unauthorized')
  unauthorized(): never {
    throw unauthorizedFailure();
  }

  @Get('not-found')
  notFound(): never {
    throw notFoundFailure();
  }

  @Get('invalid-or-used-token')
  invalidOrUsedToken(): never {
    throw invalidOrUsedTokenFailure();
  }

  @Get('explicit-unexpected')
  explicitUnexpected(): never {
    throw unexpectedFailure();
  }

  @Get('unknown-error')
  unknownError(): never {
    throw new Error(
      'SECRET=simulated-secret phone=5550109999 internalId=42 stack=private',
    );
  }

  @Get('unknown-rejection')
  async unknownRejection(): Promise<never> {
    return Promise.reject(new Error('rejected private detail'));
  }

  @Get('unknown-string')
  unknownString(): never {
    throw 'private string detail';
  }

  @Get('unknown-object')
  unknownObject(): never {
    throw { secret: 'private object detail' };
  }

  @Get('unknown-framework')
  unknownFramework(): never {
    throw new ForbiddenException('private framework detail');
  }
}

describe('request DTO and failure HTTP contract', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [ContractTestController],
    }).compile();

    app = module.createNestApplication();
    configureApplication(app, {
      port: 8000,
      secretKey: 'test-secret',
      frontendOrigin: 'http://localhost:4200',
    });
    await app.init();
  });

  afterAll(async () => app.close());

  async function expectValidationFailure(
    path: string,
    body: string | object,
  ): Promise<void> {
    const response = await request(app.getHttpServer())
      .post(path)
      .send(body)
      .expect(400, { kind: 'validation', message: 'Invalid request.' });

    expect(Object.keys(response.body).sort()).toEqual(['kind', 'message']);
  }

  it('accepts only the valid signup transport shape', async () => {
    const valid = {
      restaurantName: 'Demo',
      email: 'not-yet-business-validated',
      password: '12345678',
    };
    await request(app.getHttpServer())
      .post('/contract-test/signup')
      .send(valid)
      .expect(201, valid);

    for (const invalid of [
      {},
      { ...valid, restaurantName: '' },
      { ...valid, email: 42 },
      { ...valid, password: '1234567' },
      { ...valid, extra: 'no' },
      { restaurantName: 1, email: '', password: 'short', extra: true },
    ]) {
      await expectValidationFailure('/contract-test/signup', invalid);
    }
  });

  it('accepts only one required non-empty verification token', async () => {
    await request(app.getHttpServer())
      .post('/contract-test/verification')
      .send({ token: 'opaque' })
      .expect(201, { token: 'opaque' });

    for (const invalid of [{}, { token: '' }, { token: 1 }, { token: 'x', extra: 1 }]) {
      await expectValidationFailure('/contract-test/verification', invalid);
    }
  });

  it('requires join strings and an uncoerced integer party size from 1 to 30', async () => {
    const valid = { customerName: 'Morgan', phone: '555', partySize: 6 };
    await request(app.getHttpServer())
      .post('/contract-test/join')
      .send(valid)
      .expect(201, valid);

    for (const invalid of [
      {},
      { ...valid, customerName: '' },
      { ...valid, phone: '' },
      { ...valid, partySize: '6' },
      { ...valid, partySize: 1.5 },
      { ...valid, partySize: 0 },
      { ...valid, partySize: 31 },
      { ...valid, extra: true },
    ]) {
      await expectValidationFailure('/contract-test/join', invalid);
    }
  });

  it('accepts exactly the three lowercase staff resolutions', async () => {
    for (const resolution of ['seated', 'cancelled', 'no-show']) {
      await request(app.getHttpServer())
        .post('/contract-test/resolution')
        .send({ resolution })
        .expect(201, { resolution });
    }

    for (const invalid of [
      {},
      { resolution: '' },
      { resolution: 'Seated' },
      { resolution: 'waiting' },
      { resolution: 'seated', extra: true },
    ]) {
      await expectValidationFailure('/contract-test/resolution', invalid);
    }
  });

  it.each([
    ['null', 'null'],
    ['array', '[]'],
    ['string', '"primitive"'],
    ['number', '42'],
    ['boolean', 'true'],
  ])('maps a %s JSON body to the deterministic validation response', async (_name, body) => {
    await request(app.getHttpServer())
      .post('/contract-test/signup')
      .set('Content-Type', 'application/json')
      .send(body)
      .expect(400, { kind: 'validation', message: 'Invalid request.' });
  });

  it.each([
    [
      '/contract-test/validation-failure',
      400,
      { kind: 'validation', message: 'Safe validation detail.' },
    ],
    [
      '/contract-test/signup-conflict',
      409,
      { kind: 'validation', message: 'Safe conflict detail.' },
    ],
    [
      '/contract-test/duplicate-phone',
      409,
      {
        kind: 'duplicate-phone',
        message: 'This phone number is already on the waitlist.',
      },
    ],
    ['/contract-test/unauthorized', 401, { kind: 'unauthorized' }],
    ['/contract-test/not-found', 404, { kind: 'not-found' }],
    [
      '/contract-test/invalid-or-used-token',
      400,
      { kind: 'invalid-or-used-token' },
    ],
    [
      '/contract-test/explicit-unexpected',
      500,
      {
        kind: 'unexpected',
        message: 'Something went wrong. Please try again.',
      },
    ],
  ])('maps %s to status %i and its exact body', async (path, status, body) => {
    const response = await request(app.getHttpServer())
      .get(path)
      .set('Origin', 'http://localhost:4200')
      .expect(status, body);

    expect(response.headers['content-type']).toMatch(/^application\/json/);
    expect(response.headers['access-control-allow-origin']).toBe(
      'http://localhost:4200',
    );
    expect(response.headers['access-control-allow-credentials']).toBe('true');
    expect(response.headers.location).toBeUndefined();
    expect(response.headers['set-cookie']).toBeUndefined();
    expect(Object.keys(response.body).sort()).toEqual(Object.keys(body).sort());
  });

  it.each([
    '/contract-test/unknown-error',
    '/contract-test/unknown-rejection',
    '/contract-test/unknown-string',
    '/contract-test/unknown-object',
    '/contract-test/unknown-framework',
  ])('sanitizes unknown failure from %s', async (path) => {
    const response = await request(app.getHttpServer()).get(path).expect(500, {
      kind: 'unexpected',
      message: 'Something went wrong. Please try again.',
    });
    const serialized = JSON.stringify({
      headers: response.headers,
      body: response.body,
    });

    expect(serialized).not.toMatch(
      /simulated-secret|5550109999|internalId|private|stack/i,
    );
  });

  it('maps an unmatched framework route to the exact not-found result', async () => {
    await request(app.getHttpServer())
      .get('/definitely-unmatched')
      .expect(404, { kind: 'not-found' });
  });
});

describe('safe failure factory boundaries', () => {
  it('preserves non-empty client-safe messages unchanged', () => {
    expect(validationFailure(' Safe validation detail. ').message).toBe(
      ' Safe validation detail. ',
    );
    expect(signupConflictFailure(' Safe conflict detail. ').message).toBe(
      ' Safe conflict detail. ',
    );
  });

  it.each([validationFailure, signupConflictFailure])(
    'rejects an empty client-safe message',
    (factory) => {
      expect(() => factory('')).toThrow();
      expect(() => factory('   ')).toThrow();
    },
  );
});
