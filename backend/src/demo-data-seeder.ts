import { Injectable, OnApplicationBootstrap } from '@nestjs/common';

import { InMemoryStore } from './in-memory-store';

export const DEMO_ACCESS = Object.freeze({
  publicSlug: 'demo-restaurant',
  activePrivateStatusToken: '8f4d6e2b-1a73-4c95-b0e8-62d9f71a3c44',
  resolvedPrivateStatusToken: 'c2a7198e-6d40-4b53-9f81-37e5a6c04bd2',
  staffSessionPayload: 'demo-restaurant',
} as const);

const DEMO_PASSWORD_HASH = 'DEMO_ONLY_PASSWORD_HASH_NOT_USABLE_FOR_LOGIN';
const SAM_PRIVATE_STATUS_TOKEN = '7a2bfe87-27d4-4e13-8b0d-e7804c1e7421';
const MORGAN_ACTION_REFERENCE = '9c777a3d-b7ed-4c86-95ce-7f456a62ff11';
const SAM_ACTION_REFERENCE = 'c5f2a8d4-6b31-47e0-9a25-2d8e6c714903';
const ALEX_ACTION_REFERENCE = 'd1e8396a-4142-47f7-a10a-62941b521e38';

@Injectable()
export class SystemClock {
  now(): Date {
    return new Date();
  }
}

@Injectable()
export class DemoDataSeeder implements OnApplicationBootstrap {
  private hasSeeded = false;
  private seedPromise?: Promise<void>;

  constructor(
    private readonly store: InMemoryStore,
    private readonly clock: SystemClock,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    await this.seedPersistent();
  }

  seedPersistent(): Promise<void> {
    this.seedPromise ??= this.persistSeed().catch((error: unknown) => {
      this.seedPromise = undefined;
      throw error;
    });
    return this.seedPromise;
  }

  private async persistSeed(): Promise<void> {
    if (this.hasSeeded) {
      return;
    }
    if (this.store.findRestaurantBySlug(DEMO_ACCESS.publicSlug) !== undefined) {
      this.hasSeeded = true;
      return;
    }

    const now = this.clock.now();
    const restaurant = await this.store.createRestaurantPersistent(
      demoRestaurant(now),
    );
    for (const entry of demoEntries(restaurant.id, now)) {
      await this.store.createWaitlistEntryPersistent(entry);
    }
    this.hasSeeded = true;
  }

  seed(): void {
    if (this.hasSeeded) {
      return;
    }

    if (this.store.findRestaurantBySlug(DEMO_ACCESS.publicSlug) !== undefined) {
      this.hasSeeded = true;
      return;
    }

    const now = this.clock.now();
    const restaurant = this.store.createRestaurant(demoRestaurant(now));
    for (const entry of demoEntries(restaurant.id, now)) {
      this.store.createWaitlistEntry(entry);
    }

    this.hasSeeded = true;
  }
}

function demoRestaurant(now: Date) {
  return {
    name: 'Demo Restaurant',
    normalizedName: 'demo restaurant',
    email: 'demo@example.com',
    normalizedEmail: 'demo@example.com',
    passwordHash: DEMO_PASSWORD_HASH,
    slug: DEMO_ACCESS.publicSlug,
    verified: true,
    createdAt: now,
  };
}

function demoEntries(restaurantId: number, now: Date) {
  return [
    {
      restaurantId,
      customerName: 'Morgan Lee',
      phone: '(555) 010-1000',
      normalizedPhone: '5550101000',
      partySize: 6,
      privateStatusToken: DEMO_ACCESS.activePrivateStatusToken,
      actionReference: MORGAN_ACTION_REFERENCE,
      joinedAt: now,
      status: 'active' as const,
    },
    {
      restaurantId,
      customerName: 'Sam Rivera',
      phone: '555-010-2000',
      normalizedPhone: '5550102000',
      partySize: 2,
      privateStatusToken: SAM_PRIVATE_STATUS_TOKEN,
      actionReference: SAM_ACTION_REFERENCE,
      joinedAt: now,
      status: 'active' as const,
    },
    {
      restaurantId,
      customerName: 'Alex Chen',
      phone: '555-010-3000',
      normalizedPhone: '5550103000',
      partySize: 4,
      privateStatusToken: DEMO_ACCESS.resolvedPrivateStatusToken,
      actionReference: ALEX_ACTION_REFERENCE,
      joinedAt: now,
      status: 'seated' as const,
      resolvedAt: now,
    },
  ];
}
