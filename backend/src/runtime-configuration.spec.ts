import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';

import {
  createRuntimeConfigurationModule,
  readRuntimeConfiguration,
  validateRuntimeEnvironment,
} from './runtime-configuration';

describe('validateRuntimeEnvironment', () => {
  it('uses local defaults and accepts overrides', () => {
    expect(
      validateRuntimeEnvironment({
        SECRET_KEY: 'secret',
        DATABASE_URL: 'sqlite://./data/waitlist.sqlite',
      }),
    ).toEqual({
      PORT: 8000,
      SECRET_KEY: 'secret',
      FRONTEND_ORIGIN: 'http://localhost:4200',
      DATABASE_URL: 'sqlite://./data/waitlist.sqlite',
    });

    expect(
      validateRuntimeEnvironment({
        PORT: '8123',
        SECRET_KEY: 'override-secret',
        FRONTEND_ORIGIN: 'https://example.test:4443',
        DATABASE_URL: 'sqlite://./data/override.sqlite',
      }),
    ).toEqual({
      PORT: 8123,
      SECRET_KEY: 'override-secret',
      FRONTEND_ORIGIN: 'https://example.test:4443',
      DATABASE_URL: 'sqlite://./data/override.sqlite',
    });
  });

  it.each([undefined, '', 'postgres://db.example.test/waitlist', 'not-a-url'])(
    'rejects missing, malformed, or unsupported database URL %p without echoing it',
    (databaseUrl) => {
      expect(() =>
        validateRuntimeEnvironment({
          SECRET_KEY: 'secret',
          DATABASE_URL: databaseUrl,
        }),
      ).toThrow('Configuration error: DATABASE_URL must be a SQLite URL.');
    },
  );

  it.each([undefined, '', '   '])(
    'rejects a missing or empty secret',
    (secret) => {
      expect(() => validateRuntimeEnvironment({ SECRET_KEY: secret })).toThrow(
        'Configuration error: SECRET_KEY is required.',
      );
    },
  );

  it.each(['0', '65536', '1.5', 'abc', ''])(
    'rejects invalid port %p',
    (port) => {
      expect(() =>
        validateRuntimeEnvironment({ PORT: port, SECRET_KEY: 'secret' }),
      ).toThrow(
        'Configuration error: PORT must be an integer from 1 to 65535.',
      );
    },
  );

  it.each([
    'localhost:4200',
    'ftp://example.test',
    'http://example.test/path',
    'http://example.test?query=yes',
    'http://one.test,http://two.test',
  ])('rejects invalid frontend origin %p', (origin) => {
    expect(() =>
      validateRuntimeEnvironment({
        SECRET_KEY: 'secret',
        FRONTEND_ORIGIN: origin,
      }),
    ).toThrow(
      'Configuration error: FRONTEND_ORIGIN must be one absolute HTTP(S) origin.',
    );
  });

  it('loads values from a local env file through the runtime provider', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'waitlist-runtime-config-'));
    const envFile = join(directory, '.env');
    const previous = {
      PORT: process.env.PORT,
      SECRET_KEY: process.env.SECRET_KEY,
      FRONTEND_ORIGIN: process.env.FRONTEND_ORIGIN,
      DATABASE_URL: process.env.DATABASE_URL,
    };

    delete process.env.PORT;
    delete process.env.SECRET_KEY;
    delete process.env.FRONTEND_ORIGIN;
    delete process.env.DATABASE_URL;
    writeFileSync(
      envFile,
      'PORT=8124\nSECRET_KEY=file-secret\nFRONTEND_ORIGIN=https://frontend.test\nDATABASE_URL=sqlite://./data/test.sqlite\n',
    );

    try {
      const module = await Test.createTestingModule({
        imports: [createRuntimeConfigurationModule(envFile)],
      }).compile();

      expect(readRuntimeConfiguration(module.get(ConfigService))).toEqual({
        port: 8124,
        secretKey: 'file-secret',
        frontendOrigin: 'https://frontend.test',
        databaseUrl: 'sqlite://./data/test.sqlite',
      });
      await module.close();
    } finally {
      restoreEnvironment(previous);
      rmSync(directory, { recursive: true });
    }
  });
});

function restoreEnvironment(
  values: Record<
    'PORT' | 'SECRET_KEY' | 'FRONTEND_ORIGIN' | 'DATABASE_URL',
    string | undefined
  >,
): void {
  for (const [key, value] of Object.entries(values)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
}
