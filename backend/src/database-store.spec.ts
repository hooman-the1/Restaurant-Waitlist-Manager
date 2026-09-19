import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { ConfigService } from '@nestjs/config';

import { DatabaseStore } from './database-store';
import { DEMO_ACCESS, DemoDataSeeder } from './demo-data-seeder';

const now = new Date(2026, 8, 19, 12, 0, 0);

describe('DatabaseStore SQLite persistence', () => {
  let directory: string;
  let databaseFile: string;
  let databaseUrl: string;
  const stores: DatabaseStore[] = [];

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'waitlist-database-'));
    databaseFile = join(directory, 'waitlist.sqlite');
    databaseUrl = `sqlite:///${databaseFile.replaceAll('\\', '/')}`;
  });

  afterEach(async () => {
    for (const store of stores.splice(0)) {
      await store.onModuleDestroy();
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

  async function restart(store: DatabaseStore): Promise<DatabaseStore> {
    await store.onModuleDestroy();
    stores.splice(stores.indexOf(store), 1);
    return openStore();
  }

  it('creates its schema and preserves records, token consumption, and FIFO across restarts', async () => {
    let store = await openStore();
    const restaurant = store.createRestaurant({
      name: 'Persisted Restaurant',
      normalizedName: 'persisted restaurant',
      email: 'persisted@example.test',
      normalizedEmail: 'persisted@example.test',
      passwordHash: 'hash',
      slug: 'persisted-restaurant',
      verified: false,
      createdAt: now,
    });
    store.createVerificationToken('unused-token', restaurant.id);
    store.createVerificationToken('consumed-token', restaurant.id);
    expect(store.verifyRestaurantWithToken('consumed-token')).toMatchObject({
      kind: 'verified',
    });
    store.createWaitlistEntry({
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
    store.createWaitlistEntry({
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
    const restaurant = store.createRestaurant({
      name: 'Constraint Restaurant',
      normalizedName: 'constraint restaurant',
      email: 'constraint@example.test',
      normalizedEmail: 'constraint@example.test',
      passwordHash: 'hash',
      slug: 'constraint-restaurant',
      verified: true,
      createdAt: now,
    });
    const first = store.createWaitlistEntry({
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

    expect(() =>
      store.createWaitlistEntry({
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
    ).toThrow();
    expect(store.listActiveWaitlistEntries(restaurant.id)).toEqual([first]);

    store.resolveWaitlistEntry(first.id, 'seated', now);
    expect(
      store.commitWaitlistJoin('constraint-restaurant', {
        customerName: 'Rejoined',
        phone: '555-0101',
        normalizedPhone: '5550101',
        partySize: 3,
        privateStatusToken: 'private-rejoined',
        actionReference: 'action-rejoined',
        joinedAt: now,
      }),
    ).toMatchObject({ kind: 'created' });
  });

  it('keeps demo seeding idempotent and cleanup limited to prior-day resolved entries', async () => {
    let store = await openStore();
    new DemoDataSeeder(store, { now: () => new Date(now) }).seed();
    store.resolveWaitlistEntry(1, 'cancelled', now);
    const oldResolved = store.createWaitlistEntry({
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
    new DemoDataSeeder(store, { now: () => new Date(now) }).seed();
    expect(store.findRestaurantBySlug(DEMO_ACCESS.publicSlug)?.id).toBe(1);
    expect(store.listActiveWaitlistEntries(1)).toHaveLength(1);
    expect(store.findWaitlistEntryById(1)?.status).toBe('cancelled');

    expect(
      store.removeResolvedWaitlistEntriesBefore(new Date(2026, 8, 19, 0, 0, 0)),
    ).toBe(1);
    expect(store.findWaitlistEntryById(oldResolved.id)).toBeUndefined();
    expect(store.findWaitlistEntryById(1)?.status).toBe('cancelled');
    expect(store.listActiveWaitlistEntries(1)).toHaveLength(1);
  });
});
