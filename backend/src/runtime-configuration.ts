import { DynamicModule } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';

interface ValidatedRuntimeEnvironment {
  PORT: number;
  SECRET_KEY: string;
  FRONTEND_ORIGIN: string;
  DATABASE_URL: string;
}

export interface RuntimeConfiguration {
  port: number;
  secretKey: string;
  frontendOrigin: string;
  databaseUrl?: string;
}

export function validateRuntimeEnvironment(
  environment: Record<string, unknown>,
): ValidatedRuntimeEnvironment {
  const secretKey = environment.SECRET_KEY;
  if (
    typeof secretKey !== 'string' ||
    secretKey.trim().length === 0 ||
    secretKey === 'replace-with-a-local-signing-secret'
  ) {
    throw new Error('Configuration error: SECRET_KEY is required.');
  }

  const portValue = environment.PORT ?? '8000';
  if (
    (typeof portValue !== 'string' && typeof portValue !== 'number') ||
    !/^\d+$/.test(String(portValue))
  ) {
    throw new Error(
      'Configuration error: PORT must be an integer from 1 to 65535.',
    );
  }

  const port = Number(portValue);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(
      'Configuration error: PORT must be an integer from 1 to 65535.',
    );
  }

  const frontendOrigin = environment.FRONTEND_ORIGIN ?? 'http://localhost:4200';
  if (
    typeof frontendOrigin !== 'string' ||
    !isAbsoluteHttpOrigin(frontendOrigin)
  ) {
    throw new Error(
      'Configuration error: FRONTEND_ORIGIN must be one absolute HTTP(S) origin.',
    );
  }

  const databaseUrl = environment.DATABASE_URL;
  if (typeof databaseUrl !== 'string' || !isSupportedDatabaseUrl(databaseUrl)) {
    throw new Error(
      'Configuration error: DATABASE_URL must be a SQLite or PostgreSQL URL.',
    );
  }

  return {
    PORT: port,
    SECRET_KEY: secretKey,
    FRONTEND_ORIGIN: frontendOrigin,
    DATABASE_URL: databaseUrl,
  };
}

export function createRuntimeConfigurationModule(
  envFilePath?: string,
): Promise<DynamicModule> {
  return ConfigModule.forRoot({
    cache: true,
    envFilePath,
    isGlobal: true,
    validate: validateRuntimeEnvironment,
  });
}

export function readRuntimeConfiguration(
  config: ConfigService<ValidatedRuntimeEnvironment, true>,
): RuntimeConfiguration {
  return {
    port: config.get('PORT', { infer: true }),
    secretKey: config.get('SECRET_KEY', { infer: true }),
    frontendOrigin: config.get('FRONTEND_ORIGIN', { infer: true }),
    databaseUrl: config.get('DATABASE_URL', { infer: true }),
  };
}

function isSqliteUrl(value: string): boolean {
  return /^sqlite:\/\/(?::memory:|\.\/.+|\/.+)$/u.test(value);
}

function isSupportedDatabaseUrl(value: string): boolean {
  if (isSqliteUrl(value)) {
    return true;
  }

  try {
    const url = new URL(value);
    return (
      (url.protocol === 'postgres:' || url.protocol === 'postgresql:') &&
      url.hostname.length > 0 &&
      url.pathname.length > 1
    );
  } catch {
    return false;
  }
}

function isAbsoluteHttpOrigin(value: string): boolean {
  try {
    const url = new URL(value);

    return (
      (url.protocol === 'http:' || url.protocol === 'https:') &&
      url.host.length > 0 &&
      url.username.length === 0 &&
      url.password.length === 0 &&
      url.pathname === '/' &&
      url.search.length === 0 &&
      url.hash.length === 0
    );
  } catch {
    return false;
  }
}
