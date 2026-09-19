import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';

import { createDatabaseDataSource } from './database-configuration';
import {
  RestaurantSchema,
  VerificationTokenSchema,
  WaitlistEntrySchema,
} from './database-entities';
import { DatabaseStore } from './database-store';
import { DEMO_ACCESS, DemoDataSeeder } from './demo-data-seeder';

const now = new Date(2026, 8, 19, 12, 0, 0);

describe('DatabaseStore SQLite persistence', () => {
  let directory: string;
  let databaseFile: string;
  let databaseUrl: string;
  const stores: DatabaseStore[] = [];
  const dataSources: DataSource[] = [];

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'waitlist-database-'));
    databaseFile = join(directory, 'waitlist.sqlite');
    databaseUrl = `sqlite:///${databaseFile.replaceAll('\\', '/')}`;
  });

  afterEach(async () => {
    for (const store of stores.splice(0)) {
      await store.onModuleDestroy();
    }
    for (const dataSource of dataSources.splice(0)) {
      await dataSource.destroy();
    }
    rmSync(directory, { recursive: true, force: true });
  });

  async function openStore(): Promise<DatabaseStore> {
    const store = new DatabaseStore(
      new ConfigService({ DATABASE_URL: databaseUrl }),
    );
    await store.onModuleInit();
    stores.push(store);
    return store;
  }

  it('enforces every required schema uniqueness constraint through TypeORM', async () => {
    const dataSource = await createDatabaseDataSource(databaseUrl).initialize();
    dataSources.push(dataSource);
    const restaurants = dataSource.getRepository(RestaurantSchema);
    const tokens = dataSource.getRepository(VerificationTokenSchema);
    const entries = dataSource.getRepository(WaitlistEntrySchema);
    const baseRestaurant = {
      name: 'Unique Restaurant',
      normalizedName: 'unique restaurant',
      email: 'unique@example.test',
      normalizedEmail: 'unique@example.test',
      passwordHash: 'hash',
      slug: 'unique-restaurant',
      verified: true,
      createdAt: now,
    };
    const inserted = await restaurants.save(baseRestaurant);

    await expect(
      restaurants.insert({
        ...baseRestaurant,
        email: 'other-name@example.test',
        normalizedEmail: 'other-name@example.test',
        slug: 'other-name',
      }),
    ).rejects.toThrow();
    await expect(
      restaurants.insert({
        ...baseRestaurant,
        name: 'Other Email',
        normalizedName: 'other email',
        slug: 'other-email',
      }),
    ).rejects.toThrow();
    await expect(
      restaurants.insert({
        ...baseRestaurant,
        name: 'Other Slug',
        normalizedName: 'other slug',
        email: 'other-slug@example.test',
        normalizedEmail: 'other-slug@example.test',
      }),
    ).rejects.toThrow();

    await tokens.insert({ token: 'unique-token', restaurantId: inserted.id });
    await expect(
      tokens.insert({ token: 'unique-token', restaurantId: inserted.id }),
    ).rejects.toThrow();

    const baseEntry = {
      restaurantId: inserted.id,
      customerName: 'Customer',
      phone: '555-0101',
      normalizedPhone: '5550101',
      activePhoneKey: '5550101',
      partySize: 2,
      privateStatusToken: 'private-unique',
      actionReference: 'action-unique',
      joinedAt: now,
      status: 'active',
      resolvedAt: null,
    };
    await entries.insert(baseEntry);
    await expect(
      entries.insert({
        ...baseEntry,
        activePhoneKey: '5550102',
        normalizedPhone: '5550102',
        actionReference: 'action-other',
      }),
    ).rejects.toThrow();
    await expect(
      entries.insert({
        ...baseEntry,
        activePhoneKey: '5550103',
        normalizedPhone: '5550103',
        privateStatusToken: 'private-other',
      }),
    ).rejects.toThrow();
    await expect(
      entries.insert({
        ...baseEntry,
        privateStatusToken: 'private-phone-other',
        actionReference: 'action-phone-other',
      }),
    ).rejects.toThrow();
  });

  it('serializes competing database-backed joins so exactly one active phone wins', async () => {
    let store = await openStore();
    const restaurant = await store.createRestaurantPersistent({
      name: 'Concurrent Restaurant',
      normalizedName: 'concurrent restaurant',
      email: 'concurrent@example.test',
      normalizedEmail: 'concurrent@example.test',
      passwordHash: 'hash',
      slug: 'concurrent-restaurant',
      verified: true,
      createdAt: now,
    });

    const results = await Promise.all([
      store.commitWaitlistJoinPersistent(restaurant.slug, {
        customerName: 'First competitor',
        phone: '555-0200',
        normalizedPhone: '5550200',
        partySize: 2,
        privateStatusToken: 'private-competitor-one',
        actionReference: 'action-competitor-one',
        joinedAt: now,
      }),
      store.commitWaitlistJoinPersistent(restaurant.slug, {
        customerName: 'Second competitor',
        phone: '(555) 0200',
        normalizedPhone: '5550200',
        partySize: 4,
        privateStatusToken: 'private-competitor-two',
        actionReference: 'action-competitor-two',
        joinedAt: now,
      }),
    ]);

    expect(results.map((result) => result.kind).sort()).toEqual([
      'created',
      'duplicate-phone',
    ]);
    store = await restart(store);
    expect(store.listActiveWaitlistEntries(restaurant.id)).toHaveLength(1);
  });

  async function restart(store: DatabaseStore): Promise<DatabaseStore> {
    await store.onModuleDestroy();
    stores.splice(stores.indexOf(store), 1);
    return openStore();
  }

  it('creates its schema and preserves records, token consumption, and FIFO across restarts', async () => {
    let store = await openStore();
    const restaurant = await store.createRestaurantPersistent({
      name: 'Persisted Restaurant',
      normalizedName: 'persisted restaurant',
      email: 'persisted@example.test',
      normalizedEmail: 'persisted@example.test',
      passwordHash: 'hash',
      slug: 'persisted-restaurant',
      verified: false,
      createdAt: now,
    });
    await store.createVerificationTokenPersistent(
      'unused-token',
      restaurant.id,
    );
    await store.createVerificationTokenPersistent(
      'consumed-token',
      restaurant.id,
    );
    await expect(
      store.verifyRestaurantWithTokenPersistent('consumed-token'),
    ).resolves.toMatchObject({ kind: 'verified' });
    await store.createWaitlistEntryPersistent({
      restaurantId: restaurant.id,
      customerName: 'First',
      phone: '555-0101',
      normalizedPhone: '5550101',
      partySize: 2,
      privateStatusToken: 'private-first',
      actionReference: 'action-first',
      joinedAt: now,
      status: 'active',
    });
    await store.createWaitlistEntryPersistent({
      restaurantId: restaurant.id,
      customerName: 'Second',
      phone: '555-0102',
      normalizedPhone: '5550102',
      partySize: 4,
      privateStatusToken: 'private-second',
      actionReference: 'action-second',
      joinedAt: now,
      status: 'active',
    });

    expect(existsSync(databaseFile)).toBe(true);
    store = await restart(store);

    expect(store.findRestaurantBySlug('persisted-restaurant')).toMatchObject({
      id: restaurant.id,
      verified: true,
    });
    expect(store.findVerificationToken('unused-token')).toBeDefined();
    expect(store.findVerificationToken('consumed-token')).toBeUndefined();
    expect(store.readPrivateWaitlistStatus('private-first')).toMatchObject({
      kind: 'active',
      position: 1,
    });
    expect(store.readPrivateWaitlistStatus('private-second')).toMatchObject({
      kind: 'active',
      position: 2,
    });
  });

  it('rolls back a database constraint failure and permits rejoining after resolution', async () => {
    const store = await openStore();
    const restaurant = await store.createRestaurantPersistent({
      name: 'Constraint Restaurant',
      normalizedName: 'constraint restaurant',
      email: 'constraint@example.test',
      normalizedEmail: 'constraint@example.test',
      passwordHash: 'hash',
      slug: 'constraint-restaurant',
      verified: true,
      createdAt: now,
    });
    const first = await store.createWaitlistEntryPersistent({
      restaurantId: restaurant.id,
      customerName: 'First',
      phone: '(555) 0101',
      normalizedPhone: '5550101',
      partySize: 2,
      privateStatusToken: 'private-first',
      actionReference: 'action-first',
      joinedAt: now,
      status: 'active',
    });

    await expect(
      store.createWaitlistEntryPersistent({
        restaurantId: restaurant.id,
        customerName: 'Duplicate',
        phone: '555-0101',
        normalizedPhone: '5550101',
        partySize: 3,
        privateStatusToken: 'private-duplicate',
        actionReference: 'action-duplicate',
        joinedAt: now,
        status: 'active',
      }),
    ).rejects.toThrow();
    expect(store.listActiveWaitlistEntries(restaurant.id)).toEqual([first]);

    await store.resolveWaitlistEntryPersistent(first.id, 'seated', now);
    await expect(
      store.commitWaitlistJoinPersistent('constraint-restaurant', {
        customerName: 'Rejoined',
        phone: '555-0101',
        normalizedPhone: '5550101',
        partySize: 3,
        privateStatusToken: 'private-rejoined',
        actionReference: 'action-rejoined',
        joinedAt: now,
      }),
    ).resolves.toMatchObject({ kind: 'created' });
  });

  it('keeps demo seeding idempotent and cleanup limited to prior-day resolved entries', async () => {
    let store = await openStore();
    await new DemoDataSeeder(store, {
      now: () => new Date(now),
    }).seedPersistent();
    await store.resolveWaitlistEntryPersistent(1, 'cancelled', now);
    const oldResolved = await store.createWaitlistEntryPersistent({
      restaurantId: 1,
      customerName: 'Old',
      phone: '555-0999',
      normalizedPhone: '5550999',
      partySize: 1,
      privateStatusToken: 'private-old',
      actionReference: 'action-old',
      joinedAt: new Date(2026, 8, 18, 20, 0, 0),
      status: 'seated',
      resolvedAt: new Date(2026, 8, 18, 21, 0, 0),
    });

    store = await restart(store);
    await new DemoDataSeeder(store, {
      now: () => new Date(now),
    }).seedPersistent();
    expect(store.findRestaurantBySlug(DEMO_ACCESS.publicSlug)?.id).toBe(1);
    expect(store.listActiveWaitlistEntries(1)).toHaveLength(1);
    expect(store.findWaitlistEntryById(1)?.status).toBe('cancelled');

    await expect(
      store.removeResolvedWaitlistEntriesBeforePersistent(
        new Date(2026, 8, 19, 0, 0, 0),
      ),
    ).resolves.toBe(1);
    expect(store.findWaitlistEntryById(oldResolved.id)).toBeUndefined();
    expect(store.findWaitlistEntryById(1)?.status).toBe('cancelled');
    expect(store.listActiveWaitlistEntries(1)).toHaveLength(1);
  });
});
