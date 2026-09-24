import { createDatabaseDataSource } from './database-configuration';

describe('createDatabaseDataSource', () => {
  it('selects the SQLite driver for SQLite URLs', () => {
    expect(
      createDatabaseDataSource('sqlite://./data/waitlist.sqlite').options,
    ).toMatchObject({
      type: 'better-sqlite3',
      database: expect.stringContaining('waitlist.sqlite'),
    });
  });

  it.each([
    'postgres://db-user:db-password@localhost:5432/waitlist',
    'postgresql://db-user:db-password@localhost:5432/waitlist',
  ])('selects the PostgreSQL driver for %s', (databaseUrl) => {
    expect(createDatabaseDataSource(databaseUrl).options).toMatchObject({
      type: 'postgres',
      url: databaseUrl,
    });
  });
});
