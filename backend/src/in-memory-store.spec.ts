import { Injectable } from '@nestjs/common';
import { Test } from '@nestjs/testing';

import { AppModule } from './app.module';
import {
  CreateRestaurantInput,
  CreateWaitlistEntryInput,
  FinalWaitlistStatus,
  InMemoryStore,
} from './in-memory-store';

const createdAt = new Date(2026, 8, 12, 9, 0, 0);
const joinedAt = new Date(2026, 8, 12, 10, 0, 0);

function restaurantInput(suffix = 'one'): CreateRestaurantInput {
  return {
    name: `Restaurant ${suffix}`,
    normalizedName: `restaurant ${suffix}`,
    email: `${suffix}@example.test`,
    normalizedEmail: `${suffix}@example.test`,
    passwordHash: `hash-${suffix}`,
    slug: `restaurant-${suffix}`,
    verified: false,
    createdAt: new Date(createdAt.getTime()),
  };
}

function activeEntryInput(
  restaurantId: number,
  suffix: string,
  timestamp = joinedAt,
): CreateWaitlistEntryInput {
  return {
    restaurantId,
    customerName: `Customer ${suffix}`,
    phone: `(555) 010-${suffix}`,
    normalizedPhone: `555010${suffix}`,
    partySize: 2,
    privateStatusToken: `private-${suffix}`,
    actionReference: `action-${suffix}`,
    joinedAt: new Date(timestamp.getTime()),
    status: 'active',
  };
}

describe('InMemoryStore NestJS scope', () => {
  @Injectable()
  class FirstConsumer {
    constructor(readonly store: InMemoryStore) {}
  }

  @Injectable()
  class SecondConsumer {
    constructor(readonly store: InMemoryStore) {}
  }

  it('shares state inside one module and isolates separate modules', async () => {
    const firstModule = await Test.createTestingModule({
      imports: [AppModule],
      providers: [FirstConsumer, SecondConsumer],
    }).compile();
    const secondModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    const first = firstModule.get(FirstConsumer);
    const second = firstModule.get(SecondConsumer);
    first.store.createRestaurant(restaurantInput());

    expect(second.store.findRestaurantById(1)?.name).toBe('Restaurant one');
    expect(
      secondModule.get(InMemoryStore).findRestaurantById(1),
    ).toBeUndefined();

    await firstModule.close();
    await secondModule.close();
  });
});

describe('InMemoryStore records', () => {
  let store: InMemoryStore;

  beforeEach(() => {
    store = new InMemoryStore();
  });

  it('creates and finds complete restaurant records by every lookup key', () => {
    const restaurant = store.createRestaurant(restaurantInput());

    expect(restaurant).toEqual({ id: 1, ...restaurantInput() });
    expect(store.findRestaurantById(1)).toEqual(restaurant);
    expect(store.findRestaurantByNormalizedName('restaurant one')).toEqual(
      restaurant,
    );
    expect(store.findRestaurantByNormalizedEmail('one@example.test')).toEqual(
      restaurant,
    );
    expect(store.findRestaurantBySlug('restaurant-one')).toEqual(restaurant);
    expect(store.findRestaurantById(999)).toBeUndefined();
    expect(store.findRestaurantByNormalizedName('missing')).toBeUndefined();
    expect(store.findRestaurantByNormalizedEmail('missing')).toBeUndefined();
    expect(store.findRestaurantBySlug('missing')).toBeUndefined();
    expect(restaurant).not.toHaveProperty('password');
  });

  it('updates a restaurant only through an explicit mutation', () => {
    const restaurant = store.createRestaurant(restaurantInput());

    const updated = store.updateRestaurant(restaurant.id, { verified: true });

    expect(updated?.verified).toBe(true);
    expect(store.findRestaurantById(restaurant.id)?.verified).toBe(true);
    expect(store.updateRestaurant(999, { verified: true })).toBeUndefined();
  });

  it('consumes one verification token exactly once without changing others', () => {
    const first = store.createRestaurant(restaurantInput('first'));
    const second = store.createRestaurant(restaurantInput('second'));
    store.createVerificationToken('verify-first', first.id);
    store.createVerificationToken('verify-second', second.id);

    expect(store.findVerificationToken('verify-first')).toEqual({
      token: 'verify-first',
      restaurantId: first.id,
    });
    expect(store.consumeVerificationToken('verify-first')).toEqual({
      token: 'verify-first',
      restaurantId: first.id,
    });
    expect(store.consumeVerificationToken('verify-first')).toBeUndefined();
    expect(store.findVerificationToken('verify-second')).toEqual({
      token: 'verify-second',
      restaurantId: second.id,
    });
    expect(store.findRestaurantById(first.id)).toEqual(first);
  });

  it('finds waitlist entries by globally opaque private and staff references', () => {
    const restaurant = store.createRestaurant(restaurantInput());
    const entry = store.createWaitlistEntry(
      activeEntryInput(restaurant.id, '1000'),
    );

    expect(store.findWaitlistEntryById(entry.id)).toEqual(entry);
    expect(store.findWaitlistEntryByPrivateStatusToken('private-1000')).toEqual(
      entry,
    );
    expect(store.findWaitlistEntryByActionReference('action-1000')).toEqual(
      entry,
    );
    expect(
      store.findWaitlistEntryByPrivateStatusToken('missing'),
    ).toBeUndefined();
    expect(store.findWaitlistEntryByActionReference('missing')).toBeUndefined();
  });

  it('lists active entries by restaurant in stable insertion order', () => {
    const firstRestaurant = store.createRestaurant(restaurantInput('first'));
    const secondRestaurant = store.createRestaurant(restaurantInput('second'));
    const first = store.createWaitlistEntry(
      activeEntryInput(firstRestaurant.id, '1000'),
    );
    const second = store.createWaitlistEntry({
      ...activeEntryInput(firstRestaurant.id, '1001'),
      partySize: 20,
    });
    const third = store.createWaitlistEntry(
      activeEntryInput(firstRestaurant.id, '1002'),
    );
    store.createWaitlistEntry(activeEntryInput(secondRestaurant.id, '2000'));

    expect(store.listActiveWaitlistEntries(firstRestaurant.id)).toEqual([
      first,
      second,
      third,
    ]);

    store.removeWaitlistEntry(first.id);
    expect(store.listActiveWaitlistEntries(firstRestaurant.id)).toEqual([
      second,
      third,
    ]);
  });

  it.each<FinalWaitlistStatus>(['seated', 'cancelled', 'no-show'])(
    'resolves exactly one active entry as %s',
    (status) => {
      const restaurant = store.createRestaurant(restaurantInput());
      const target = store.createWaitlistEntry(
        activeEntryInput(restaurant.id, '1000'),
      );
      const untouched = store.createWaitlistEntry(
        activeEntryInput(restaurant.id, '1001'),
      );
      const alsoUntouched = store.createWaitlistEntry(
        activeEntryInput(restaurant.id, '1002'),
      );
      const resolvedAt = new Date(2026, 8, 12, 10, 30, 0);

      const resolved = store.resolveWaitlistEntry(
        target.id,
        status,
        resolvedAt,
      );

      expect(resolved).toEqual({ ...target, status, resolvedAt });
      expect(store.listActiveWaitlistEntries(restaurant.id)).toEqual([
        untouched,
        alsoUntouched,
      ]);
      expect(store.listResolvedWaitlistEntries(restaurant.id)).toEqual([
        resolved,
      ]);
      expect(
        store.findWaitlistEntryByPrivateStatusToken(target.privateStatusToken),
      ).toEqual(resolved);
      expect(
        store.findWaitlistEntryByActionReference(target.actionReference),
      ).toEqual(resolved);
      expect(store.findWaitlistEntryById(untouched.id)).toEqual(untouched);
      expect(store.findWaitlistEntryById(alsoUntouched.id)).toEqual(
        alsoUntouched,
      );
      expect(
        store.resolveWaitlistEntry(999, status, resolvedAt),
      ).toBeUndefined();
    },
  );

  it('lists pre-created resolved entries only for their restaurant', () => {
    const firstRestaurant = store.createRestaurant(restaurantInput('first'));
    const secondRestaurant = store.createRestaurant(restaurantInput('second'));
    const resolutionTimestamp = new Date(2026, 8, 12, 11, 0, 0);
    const resolved = store.createWaitlistEntry({
      ...activeEntryInput(firstRestaurant.id, '1000'),
      status: 'seated',
      resolvedAt: resolutionTimestamp,
    });
    store.createWaitlistEntry({
      ...activeEntryInput(secondRestaurant.id, '2000'),
      status: 'cancelled',
      resolvedAt: resolutionTimestamp,
    });

    expect(store.listResolvedWaitlistEntries(firstRestaurant.id)).toEqual([
      resolved,
    ]);
  });

  it('defensively isolates supplied and returned values from backing state', () => {
    const input = restaurantInput();
    const restaurant = store.createRestaurant(input);
    input.createdAt.setFullYear(1999);
    restaurant.createdAt.setFullYear(1998);
    restaurant.name = 'mutated outside';

    expect(store.findRestaurantById(restaurant.id)).toEqual({
      id: 1,
      ...restaurantInput(),
    });

    const entry = store.createWaitlistEntry(
      activeEntryInput(restaurant.id, '1000'),
    );
    entry.joinedAt.setFullYear(1997);
    entry.customerName = 'mutated outside';
    const listed = store.listActiveWaitlistEntries(restaurant.id);
    listed[0].phone = 'mutated outside';

    expect(store.findWaitlistEntryById(entry.id)).toEqual({
      id: 1,
      ...activeEntryInput(restaurant.id, '1000'),
    });

    const token = store.createVerificationToken('verify-one', restaurant.id);
    token.restaurantId = 999;
    expect(store.findVerificationToken('verify-one')?.restaurantId).toBe(
      restaurant.id,
    );
  });

  it('rejects invalid status and resolution timestamp combinations at runtime', () => {
    const restaurant = store.createRestaurant(restaurantInput());
    const active = activeEntryInput(restaurant.id, '1000');

    expect(() =>
      store.createWaitlistEntry({
        ...active,
        resolvedAt: new Date(),
      } as unknown as CreateWaitlistEntryInput),
    ).toThrow('Active waitlist entries cannot have a resolution time.');
    expect(() =>
      store.createWaitlistEntry({
        ...active,
        status: 'seated',
      } as unknown as CreateWaitlistEntryInput),
    ).toThrow('Resolved waitlist entries require a resolution time.');
    expect(() =>
      store.createWaitlistEntry({
        ...active,
        status: 'waiting',
      } as unknown as CreateWaitlistEntryInput),
    ).toThrow('Invalid final waitlist status.');
  });

  it('resets all state and deterministic identifier sequencing in one instance', () => {
    const isolatedStore = new InMemoryStore();
    const restaurant = store.createRestaurant(restaurantInput());
    store.createVerificationToken('verify-one', restaurant.id);
    store.createWaitlistEntry(activeEntryInput(restaurant.id, '1000'));
    isolatedStore.createRestaurant(restaurantInput('isolated'));

    store.reset();

    expect(store.findRestaurantById(restaurant.id)).toBeUndefined();
    expect(store.findVerificationToken('verify-one')).toBeUndefined();
    expect(store.findWaitlistEntryById(1)).toBeUndefined();
    expect(store.createRestaurant(restaurantInput('after-reset')).id).toBe(1);
    expect(
      store.createWaitlistEntry(activeEntryInput(1, 'after-reset')).id,
    ).toBe(1);
    expect(isolatedStore.findRestaurantById(1)?.name).toBe(
      'Restaurant isolated',
    );
  });
});
