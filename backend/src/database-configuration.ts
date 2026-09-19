import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

import { DataSource } from 'typeorm';

import { DATABASE_ENTITIES } from './database-entities';

export function databasePathFromUrl(databaseUrl: string): string {
  const location = databaseUrl.slice('sqlite://'.length);
  if (location === ':memory:') {
    return location;
  }

  const normalizedLocation = /^\/[A-Za-z]:\//u.test(location)
    ? location.slice(1)
    : location;
  const path = normalizedLocation.startsWith('./')
    ? resolve(process.cwd(), normalizedLocation.slice(2))
    : resolve(normalizedLocation);
  mkdirSync(dirname(path), { recursive: true });
  return path;
}

export function createDatabaseDataSource(databaseUrl: string): DataSource {
  return new DataSource({
    type: 'better-sqlite3',
    database: databasePathFromUrl(databaseUrl),
    entities: DATABASE_ENTITIES,
    synchronize: true,
    logging: false,
  });
}
