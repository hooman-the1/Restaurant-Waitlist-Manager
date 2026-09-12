import {
  Body,
  Controller,
  Get,
  INestApplication,
  Post,
  Req,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { IsString } from 'class-validator';
import { sign } from 'cookie-signature';
import { Request } from 'express';
import request = require('supertest');

import { configureApplication } from './application-configuration';

class TestBody {
  @IsString()
  declared!: string;
}

@Controller('runtime-test')
class RuntimeTestController {
  @Get('cookie')
  readCookie(@Req() request: Request): unknown {
    const signedValue = request.signedCookies.testCookie;

    return { signed: typeof signedValue === 'string' ? signedValue : null };
  }

  @Post('body')
  readBody(@Body() body: TestBody): TestBody {
    return body;
  }
}

describe('configureApplication', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [RuntimeTestController],
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

  it('allows the configured credentialed origin', async () => {
    const response = await request(app.getHttpServer())
      .options('/runtime-test/body')
      .set('Origin', 'http://localhost:4200')
      .set('Access-Control-Request-Method', 'POST')
      .expect(204);

    expect(response.headers['access-control-allow-origin']).toBe(
      'http://localhost:4200',
    );
    expect(response.headers['access-control-allow-credentials']).toBe('true');
  });

  it('does not grant a different origin and permits requests without Origin', async () => {
    const denied = await request(app.getHttpServer())
      .get('/runtime-test/cookie')
      .set('Origin', 'http://different.test')
      .expect(200);
    expect(denied.headers['access-control-allow-origin']).toBeUndefined();

    await request(app.getHttpServer()).get('/runtime-test/cookie').expect(200);
  });

  it('accepts only correctly signed cookie values as signed', async () => {
    const signedValue = `s:${sign('accepted', 'test-secret')}`;

    await request(app.getHttpServer())
      .get('/runtime-test/cookie')
      .set('Cookie', `testCookie=${signedValue}`)
      .expect(200, { signed: 'accepted' });

    await request(app.getHttpServer())
      .get('/runtime-test/cookie')
      .set('Cookie', 'testCookie=unsigned')
      .expect(200, { signed: null });

    await request(app.getHttpServer())
      .get('/runtime-test/cookie')
      .set('Cookie', `testCookie=${signedValue}tampered`)
      .expect(200, { signed: null });
  });

  it('parses valid JSON and rejects malformed JSON', async () => {
    await request(app.getHttpServer())
      .post('/runtime-test/body')
      .send({ declared: 'value' })
      .expect(201, { declared: 'value' });

    await request(app.getHttpServer())
      .post('/runtime-test/body')
      .set('Content-Type', 'application/json')
      .send('{"declared":')
      .expect(400);
  });

  it('rejects undeclared DTO properties', async () => {
    await request(app.getHttpServer())
      .post('/runtime-test/body')
      .send({ declared: 'value', extra: 'rejected' })
      .expect(400);

    await request(app.getHttpServer())
      .post('/runtime-test/body')
      .send({ declared: 'value' })
      .expect(201, { declared: 'value' });
  });
});
