import { Test, TestingModule } from '@nestjs/testing';

import { AppModule } from './app.module';
import { DEMO_ACCESS, DemoDataSeeder, SystemClock } from './demo-data-seeder';
import { InMemoryStore } from './in-memory-store';

const fixedNow = new Date(2026, 8, 12, 14, 30, 15);

async function createInitializedModule(): Promise<{
  module: TestingModule;
  store: InMemoryStore;
  seeder: DemoDataSeeder;
  now: jest.Mock<Date, []>;
}> {
  const now = jest.fn(() => new Date(fixedNow.getTime()));
  const module = await Test.createTestingModule({
    imports: [AppModule],
  })
    .overrideProvider(SystemClock)
    .useValue({ now })
    .compile();

  await module.init();

  return {
    module,
    store: module.get(InMemoryStore),
    seeder: module.get(DemoDataSeeder),
    now,
  };
}

describe('DemoDataSeeder', () => {
  it('automatically seeds the exact verified demo restaurant on initialization', async () => {
    const { module, store, now } = await createInitializedModule();

    expect(store.findRestaurantBySlug(DEMO_ACCESS.publicSlug)).toEqual({
      id: 1,
      name: 'Demo Restaurant',
      normalizedName: 'demo restaurant',
      email: 'demo@example.com',
      normalizedEmail: 'demo@example.com',
      passwordHash: 'DEMO_ONLY_PASSWORD_HASH_NOT_USABLE_FOR_LOGIN',
      slug: 'demo-restaurant',
      verified: true,
      createdAt: fixedNow,
    });
    expect(store.findRestaurantById(2)).toBeUndefined();
    expect(store.findVerificationToken(DEMO_ACCESS.publicSlug)).toBeUndefined();
    expect(now).toHaveBeenCalledTimes(2);

    await module.close();
  });

  it('seeds Morgan and Sam as the exact active FIFO queue', async () => {
    const { module, store } = await createInitializedModule();
    const active = store.listActiveWaitlistEntries(1);

    expect(active).toEqual([
      {
        id: 1,
        restaurantId: 1,
        customerName: 'Morgan Lee',
        phone: '(555) 010-1000',
        normalizedPhone: '5550101000',
        partySize: 6,
        privateStatusToken: '8f4d6e2b-1a73-4c95-b0e8-62d9f71a3c44',
        actionReference: '9c777a3d-b7ed-4c86-95ce-7f456a62ff11',
        joinedAt: fixedNow,
        status: 'active',
      },
      {
        id: 2,
        restaurantId: 1,
        customerName: 'Sam Rivera',
        phone: '555-010-2000',
        normalizedPhone: '5550102000',
        partySize: 2,
        privateStatusToken: '7a2bfe87-27d4-4e13-8b0d-e7804c1e7421',
        actionReference: 'c5f2a8d4-6b31-47e0-9a25-2d8e6c714903',
        joinedAt: fixedNow,
        status: 'active',
      },
    ]);
    expect(
      store.findWaitlistEntryByPrivateStatusToken(
        DEMO_ACCESS.activePrivateStatusToken,
      ),
    ).toEqual(active[0]);

    await module.close();
  });

  it('seeds Alex as the only same-local-day resolved entry', async () => {
    const { module, store } = await createInitializedModule();
    const resolved = store.listResolvedWaitlistEntries(1);

    expect(resolved).toEqual([
      {
        id: 3,
        restaurantId: 1,
        customerName: 'Alex Chen',
        phone: '555-010-3000',
        normalizedPhone: '5550103000',
        partySize: 4,
        privateStatusToken: 'c2a7198e-6d40-4b53-9f81-37e5a6c04bd2',
        actionReference: 'd1e8396a-4142-47f7-a10a-62941b521e38',
        joinedAt: fixedNow,
        status: 'seated',
        resolvedAt: fixedNow,
      },
    ]);
    expect(
      store.findWaitlistEntryByPrivateStatusToken(
        DEMO_ACCESS.resolvedPrivateStatusToken,
      ),
    ).toEqual(resolved[0]);
    expect(resolved[0].resolvedAt.getFullYear()).toBe(fixedNow.getFullYear());
    expect(resolved[0].resolvedAt.getMonth()).toBe(fixedNow.getMonth());
    expect(resolved[0].resolvedAt.getDate()).toBe(fixedNow.getDate());

    await module.close();
  });

  it('centralizes stable non-sensitive access values without collisions or identity data', () => {
    expect(DEMO_ACCESS).toEqual({
      publicSlug: 'demo-restaurant',
      activePrivateStatusToken: '8f4d6e2b-1a73-4c95-b0e8-62d9f71a3c44',
      resolvedPrivateStatusToken: 'c2a7198e-6d40-4b53-9f81-37e5a6c04bd2',
      staffSessionPayload: 'demo-restaurant',
    });

    const capabilities = [
      DEMO_ACCESS.activePrivateStatusToken,
      DEMO_ACCESS.resolvedPrivateStatusToken,
      '7a2bfe87-27d4-4e13-8b0d-e7804c1e7421',
      '9c777a3d-b7ed-4c86-95ce-7f456a62ff11',
      'c5f2a8d4-6b31-47e0-9a25-2d8e6c714903',
      'd1e8396a-4142-47f7-a10a-62941b521e38',
    ];
    expect(new Set(capabilities).size).toBe(capabilities.length);
    expect(capabilities.every((value) => value.length > 0)).toBe(true);
    expect(capabilities.join(' ')).not.toMatch(
      /Morgan|Sam|Alex|555|demo@example|\b[123]\b/i,
    );
  });

  it('is a no-op after successful seeding and does not resurrect mutations', async () => {
    const { module, store, seeder, now } = await createInitializedModule();
    const originalMorgan = store.findWaitlistEntryById(1);
    const originalSam = store.findWaitlistEntryById(2);
    const originalAlex = store.findWaitlistEntryById(3);
    const resolvedAt = new Date(2026, 8, 12, 15, 0, 0);
    store.resolveWaitlistEntry(1, 'cancelled', resolvedAt);

    seeder.seed();
    seeder.seed();

    expect(now).toHaveBeenCalledTimes(2);
    expect(store.findWaitlistEntryById(1)).toEqual({
      ...originalMorgan,
      status: 'cancelled',
      resolvedAt,
    });
    expect(
      store.listActiveWaitlistEntries(1).map((entry) => entry.customerName),
    ).toEqual(['Sam Rivera']);
    expect(store.findWaitlistEntryById(2)).toEqual(originalSam);
    expect(store.findWaitlistEntryById(3)).toEqual(originalAlex);
    const afterSeedRestaurant = store.createRestaurant({
      name: 'After Seed',
      normalizedName: 'after seed',
      email: 'after@example.test',
      normalizedEmail: 'after@example.test',
      passwordHash: 'hash',
      slug: 'after-seed',
      verified: false,
      createdAt: fixedNow,
    });
    expect(afterSeedRestaurant.id).toBe(2);
    expect(
      store.createWaitlistEntry({
        restaurantId: afterSeedRestaurant.id,
        customerName: 'After Seed',
        phone: 'after-seed',
        normalizedPhone: 'after-seed',
        partySize: 1,
        privateStatusToken: 'after-seed-private',
        actionReference: 'after-seed-action',
        joinedAt: fixedNow,
        status: 'active',
      }).id,
    ).toBe(4);

    await module.close();
  });

  it('stays empty after explicit reset in the same instance', async () => {
    const { module, store, seeder, now } = await createInitializedModule();

    store.reset();
    seeder.seed();

    expect(store.findRestaurantById(1)).toBeUndefined();
    expect(store.findWaitlistEntryById(1)).toBeUndefined();
    expect(now).toHaveBeenCalledTimes(2);

    await module.close();
  });

  it('reproduces the fresh deterministic seed in a new application instance', async () => {
    const first = await createInitializedModule();
    const firstSnapshot = {
      restaurant: first.store.findRestaurantBySlug(DEMO_ACCESS.publicSlug),
      active: first.store.listActiveWaitlistEntries(1),
      resolved: first.store.listResolvedWaitlistEntries(1),
    };
    first.store.reset();

    const second = await createInitializedModule();
    expect({
      restaurant: second.store.findRestaurantBySlug(DEMO_ACCESS.publicSlug),
      active: second.store.listActiveWaitlistEntries(1),
      resolved: second.store.listResolvedWaitlistEntries(1),
    }).toEqual(firstSnapshot);
    expect(second.now).toHaveBeenCalledTimes(2);

    await first.module.close();
    await second.module.close();
  });
});
