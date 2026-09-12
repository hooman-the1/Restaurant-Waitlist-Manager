import { Injectable } from '@nestjs/common';

export interface RestaurantRecord {
  id: number;
  name: string;
  normalizedName: string;
  email: string;
  normalizedEmail: string;
  passwordHash: string;
  slug: string;
  verified: boolean;
  createdAt: Date;
}

export type CreateRestaurantInput = Omit<RestaurantRecord, 'id'>;
export type UpdateRestaurantInput = Partial<CreateRestaurantInput>;

export interface VerificationTokenRecord {
  token: string;
  restaurantId: number;
}

export type FinalWaitlistStatus = 'seated' | 'cancelled' | 'no-show';
export type WaitlistStatus = 'active' | FinalWaitlistStatus;

interface WaitlistEntryBase {
  id: number;
  restaurantId: number;
  customerName: string;
  phone: string;
  normalizedPhone: string;
  partySize: number;
  privateStatusToken: string;
  actionReference: string;
  joinedAt: Date;
}

export interface ActiveWaitlistEntryRecord extends WaitlistEntryBase {
  status: 'active';
  resolvedAt?: never;
}

export interface ResolvedWaitlistEntryRecord extends WaitlistEntryBase {
  status: FinalWaitlistStatus;
  resolvedAt: Date;
}

export type WaitlistEntryRecord =
  | ActiveWaitlistEntryRecord
  | ResolvedWaitlistEntryRecord;

export type CreateWaitlistEntryInput =
  | Omit<ActiveWaitlistEntryRecord, 'id'>
  | Omit<ResolvedWaitlistEntryRecord, 'id'>;

@Injectable()
export class InMemoryStore {
  private readonly restaurants = new Map<number, RestaurantRecord>();
  private readonly verificationTokens = new Map<
    string,
    VerificationTokenRecord
  >();
  private readonly waitlistEntries = new Map<number, WaitlistEntryRecord>();
  private nextRestaurantId = 1;
  private nextWaitlistEntryId = 1;

  createRestaurant(input: CreateRestaurantInput): RestaurantRecord {
    const restaurant = cloneRestaurant({
      ...input,
      id: this.nextRestaurantId++,
    });
    this.restaurants.set(restaurant.id, restaurant);

    return cloneRestaurant(restaurant);
  }

  updateRestaurant(
    id: number,
    updates: UpdateRestaurantInput,
  ): RestaurantRecord | undefined {
    const restaurant = this.restaurants.get(id);
    if (restaurant === undefined) {
      return undefined;
    }

    const updated = cloneRestaurant({ ...restaurant, ...updates, id });
    this.restaurants.set(id, updated);

    return cloneRestaurant(updated);
  }

  findRestaurantById(id: number): RestaurantRecord | undefined {
    return cloneOptionalRestaurant(this.restaurants.get(id));
  }

  findRestaurantByNormalizedName(
    normalizedName: string,
  ): RestaurantRecord | undefined {
    return cloneOptionalRestaurant(
      [...this.restaurants.values()].find(
        (restaurant) => restaurant.normalizedName === normalizedName,
      ),
    );
  }

  findRestaurantByNormalizedEmail(
    normalizedEmail: string,
  ): RestaurantRecord | undefined {
    return cloneOptionalRestaurant(
      [...this.restaurants.values()].find(
        (restaurant) => restaurant.normalizedEmail === normalizedEmail,
      ),
    );
  }

  findRestaurantBySlug(slug: string): RestaurantRecord | undefined {
    return cloneOptionalRestaurant(
      [...this.restaurants.values()].find(
        (restaurant) => restaurant.slug === slug,
      ),
    );
  }

  createVerificationToken(
    token: string,
    restaurantId: number,
  ): VerificationTokenRecord {
    const record = { token, restaurantId };
    this.verificationTokens.set(token, record);

    return { ...record };
  }

  findVerificationToken(token: string): VerificationTokenRecord | undefined {
    const record = this.verificationTokens.get(token);

    return record === undefined ? undefined : { ...record };
  }

  consumeVerificationToken(
    token: string,
  ): VerificationTokenRecord | undefined {
    const record = this.verificationTokens.get(token);
    if (record === undefined) {
      return undefined;
    }

    this.verificationTokens.delete(token);

    return { ...record };
  }

  createWaitlistEntry(
    input: CreateWaitlistEntryInput,
  ): WaitlistEntryRecord {
    assertValidWaitlistEntry(input);
    const entry = cloneWaitlistEntry({
      ...input,
      id: this.nextWaitlistEntryId++,
    });
    this.waitlistEntries.set(entry.id, entry);

    return cloneWaitlistEntry(entry);
  }

  findWaitlistEntryById(id: number): WaitlistEntryRecord | undefined {
    return cloneOptionalWaitlistEntry(this.waitlistEntries.get(id));
  }

  findWaitlistEntryByPrivateStatusToken(
    token: string,
  ): WaitlistEntryRecord | undefined {
    return cloneOptionalWaitlistEntry(
      [...this.waitlistEntries.values()].find(
        (entry) => entry.privateStatusToken === token,
      ),
    );
  }

  findWaitlistEntryByActionReference(
    reference: string,
  ): WaitlistEntryRecord | undefined {
    return cloneOptionalWaitlistEntry(
      [...this.waitlistEntries.values()].find(
        (entry) => entry.actionReference === reference,
      ),
    );
  }

  listActiveWaitlistEntries(restaurantId: number): ActiveWaitlistEntryRecord[] {
    return [...this.waitlistEntries.values()]
      .filter(
        (entry): entry is ActiveWaitlistEntryRecord =>
          entry.restaurantId === restaurantId && entry.status === 'active',
      )
      .map(cloneWaitlistEntry);
  }

  listResolvedWaitlistEntries(
    restaurantId: number,
  ): ResolvedWaitlistEntryRecord[] {
    return [...this.waitlistEntries.values()]
      .filter(
        (entry): entry is ResolvedWaitlistEntryRecord =>
          entry.restaurantId === restaurantId && entry.status !== 'active',
      )
      .map(cloneWaitlistEntry);
  }

  resolveWaitlistEntry(
    id: number,
    status: FinalWaitlistStatus,
    resolvedAt: Date,
  ): ResolvedWaitlistEntryRecord | undefined {
    assertFinalWaitlistStatus(status);
    const entry = this.waitlistEntries.get(id);
    if (entry === undefined || entry.status !== 'active') {
      return undefined;
    }

    const resolved = cloneWaitlistEntry({
      ...entry,
      status,
      resolvedAt,
    });
    this.waitlistEntries.set(id, resolved);

    return cloneWaitlistEntry(resolved);
  }

  removeWaitlistEntry(id: number): boolean {
    return this.waitlistEntries.delete(id);
  }

  reset(): void {
    this.restaurants.clear();
    this.verificationTokens.clear();
    this.waitlistEntries.clear();
    this.nextRestaurantId = 1;
    this.nextWaitlistEntryId = 1;
  }
}

function cloneRestaurant(record: RestaurantRecord): RestaurantRecord {
  return { ...record, createdAt: new Date(record.createdAt.getTime()) };
}

function cloneOptionalRestaurant(
  record: RestaurantRecord | undefined,
): RestaurantRecord | undefined {
  return record === undefined ? undefined : cloneRestaurant(record);
}

function cloneWaitlistEntry<T extends WaitlistEntryRecord>(record: T): T {
  if (record.status === 'active') {
    return {
      ...record,
      joinedAt: new Date(record.joinedAt.getTime()),
    };
  }

  return {
    ...record,
    joinedAt: new Date(record.joinedAt.getTime()),
    resolvedAt: new Date(record.resolvedAt.getTime()),
  };
}

function cloneOptionalWaitlistEntry(
  record: WaitlistEntryRecord | undefined,
): WaitlistEntryRecord | undefined {
  return record === undefined ? undefined : cloneWaitlistEntry(record);
}

function assertValidWaitlistEntry(input: CreateWaitlistEntryInput): void {
  if (input.status === 'active') {
    if (input.resolvedAt !== undefined) {
      throw new Error('Active waitlist entries cannot have a resolution time.');
    }
    return;
  }

  assertFinalWaitlistStatus(input.status);
  if (!(input.resolvedAt instanceof Date)) {
    throw new Error('Resolved waitlist entries require a resolution time.');
  }
}

function assertFinalWaitlistStatus(
  status: string,
): asserts status is FinalWaitlistStatus {
  if (!['seated', 'cancelled', 'no-show'].includes(status)) {
    throw new Error('Invalid final waitlist status.');
  }
}
