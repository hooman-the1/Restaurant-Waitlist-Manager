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

export interface RestaurantUniquenessKeys {
  normalizedName: string;
  normalizedEmail: string;
  slug: string;
}

export type RestaurantSignupCommitResult =
  | { kind: 'created'; restaurant: RestaurantRecord }
  | { kind: 'conflict' }
  | { kind: 'token-collision' };

export interface VerificationTokenRecord {
  token: string;
  restaurantId: number;
}

export type RestaurantVerificationResult =
  | { kind: 'verified'; restaurant: RestaurantRecord }
  | { kind: 'invalid' };

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

export type WaitlistJoinInput = Omit<
  ActiveWaitlistEntryRecord,
  'id' | 'restaurantId' | 'status'
>;

export type WaitlistJoinCommitResult =
  | { kind: 'created'; entry: ActiveWaitlistEntryRecord }
  | { kind: 'not-found' }
  | { kind: 'duplicate-phone' }
  | { kind: 'capability-collision' };

export type PrivateWaitlistStatusReadResult =
  | { kind: 'active'; restaurantName: string; position: number }
  | {
      kind: 'resolved';
      restaurantName: string;
      finalStatus: FinalWaitlistStatus;
    }
  | { kind: 'not-found' };

export type WaitlistCancellationResult =
  | { kind: 'cancelled'; entry: ResolvedWaitlistEntryRecord }
  | { kind: 'not-found' };

export interface DashboardActiveEntry {
  position: number;
  customerName: string;
  phone: string;
  partySize: number;
  actionReference: string;
}

export interface DashboardResolvedEntry {
  customerName: string;
  partySize: number;
  finalStatus: FinalWaitlistStatus;
}

export interface DashboardSnapshot {
  restaurantName: string;
  activeEntries: DashboardActiveEntry[];
  resolvedToday: DashboardResolvedEntry[];
}

export type StaffWaitlistResolutionResult =
  | { kind: 'resolved'; entry: ResolvedWaitlistEntryRecord }
  | { kind: 'not-found' };

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

  hasRestaurantConflict(keys: RestaurantUniquenessKeys): boolean {
    return (
      this.findRestaurantByNormalizedName(keys.normalizedName) !== undefined ||
      this.findRestaurantByNormalizedEmail(keys.normalizedEmail) !== undefined ||
      this.findRestaurantBySlug(keys.slug) !== undefined
    );
  }

  commitRestaurantSignup(
    input: CreateRestaurantInput,
    verificationToken: string,
  ): RestaurantSignupCommitResult {
    if (this.hasRestaurantConflict(input)) {
      return { kind: 'conflict' };
    }
    if (this.verificationTokens.has(verificationToken)) {
      return { kind: 'token-collision' };
    }

    const restaurant = cloneRestaurant({
      ...input,
      id: this.nextRestaurantId,
    });
    this.restaurants.set(restaurant.id, restaurant);
    try {
      this.verificationTokens.set(verificationToken, {
        token: verificationToken,
        restaurantId: restaurant.id,
      });
    } catch (error: unknown) {
      this.restaurants.delete(restaurant.id);
      throw error;
    }
    this.nextRestaurantId += 1;

    return { kind: 'created', restaurant: cloneRestaurant(restaurant) };
  }

  rollbackRestaurantSignup(
    restaurantId: number,
    verificationToken: string,
  ): boolean {
    const token = this.verificationTokens.get(verificationToken);
    if (
      token?.restaurantId !== restaurantId ||
      restaurantId !== this.nextRestaurantId - 1
    ) {
      return false;
    }

    this.verificationTokens.delete(verificationToken);
    this.restaurants.delete(restaurantId);
    this.nextRestaurantId = restaurantId;

    return true;
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

  verifyRestaurantWithToken(token: string): RestaurantVerificationResult {
    const verification = this.verificationTokens.get(token);
    if (verification === undefined) {
      return { kind: 'invalid' };
    }

    const restaurant = this.restaurants.get(verification.restaurantId);
    if (restaurant === undefined || restaurant.verified) {
      this.verificationTokens.delete(token);
      return { kind: 'invalid' };
    }

    const verifiedRestaurant = cloneRestaurant({
      ...restaurant,
      verified: true,
    });
    this.restaurants.set(restaurant.id, verifiedRestaurant);
    try {
      if (!this.verificationTokens.delete(token)) {
        throw new Error('Verification token disappeared during commit.');
      }
    } catch (error: unknown) {
      this.restaurants.set(restaurant.id, restaurant);
      throw error;
    }

    return {
      kind: 'verified',
      restaurant: cloneRestaurant(verifiedRestaurant),
    };
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

  readPrivateWaitlistStatus(
    token: string,
  ): PrivateWaitlistStatusReadResult {
    const entry = [...this.waitlistEntries.values()].find(
      (candidate) => candidate.privateStatusToken === token,
    );
    if (entry === undefined) {
      return { kind: 'not-found' };
    }

    const restaurant = this.restaurants.get(entry.restaurantId);
    if (restaurant === undefined) {
      return { kind: 'not-found' };
    }
    if (entry.status !== 'active') {
      return {
        kind: 'resolved',
        restaurantName: restaurant.name,
        finalStatus: entry.status,
      };
    }

    let position = 0;
    for (const candidate of this.waitlistEntries.values()) {
      if (
        candidate.restaurantId === restaurant.id &&
        candidate.status === 'active'
      ) {
        position += 1;
        if (candidate.id === entry.id) {
          return {
            kind: 'active',
            restaurantName: restaurant.name,
            position,
          };
        }
      }
    }

    return { kind: 'not-found' };
  }

  cancelWaitlistEntry(
    token: string,
    readResolutionTime: () => Date,
  ): WaitlistCancellationResult {
    const entry = [...this.waitlistEntries.values()].find(
      (candidate) => candidate.privateStatusToken === token,
    );
    if (
      entry === undefined ||
      entry.status !== 'active' ||
      !this.restaurants.has(entry.restaurantId)
    ) {
      return { kind: 'not-found' };
    }

    const cancelled = cloneWaitlistEntry({
      ...entry,
      status: 'cancelled' as const,
      resolvedAt: readResolutionTime(),
    });
    try {
      this.waitlistEntries.set(entry.id, cancelled);
    } catch (error: unknown) {
      this.waitlistEntries.set(entry.id, entry);
      throw error;
    }

    return { kind: 'cancelled', entry: cloneWaitlistEntry(cancelled) };
  }

  readDashboardSnapshot(
    restaurantId: number,
    currentTime: Date,
  ): DashboardSnapshot | undefined {
    const restaurant = this.restaurants.get(restaurantId);
    if (restaurant === undefined) {
      return undefined;
    }

    const startOfToday = new Date(
      currentTime.getFullYear(),
      currentTime.getMonth(),
      currentTime.getDate(),
    );
    const startOfTomorrow = new Date(
      currentTime.getFullYear(),
      currentTime.getMonth(),
      currentTime.getDate() + 1,
    );
    const activeEntries: DashboardActiveEntry[] = [];
    const resolvedToday: DashboardResolvedEntry[] = [];

    for (const entry of this.waitlistEntries.values()) {
      if (entry.restaurantId !== restaurant.id) {
        continue;
      }
      if (entry.status === 'active') {
        activeEntries.push({
          position: activeEntries.length + 1,
          customerName: entry.customerName,
          phone: entry.phone,
          partySize: entry.partySize,
          actionReference: entry.actionReference,
        });
      } else if (
        entry.resolvedAt >= startOfToday &&
        entry.resolvedAt < startOfTomorrow
      ) {
        resolvedToday.push({
          customerName: entry.customerName,
          partySize: entry.partySize,
          finalStatus: entry.status,
        });
      }
    }

    return {
      restaurantName: restaurant.name,
      activeEntries,
      resolvedToday,
    };
  }

  resolveWaitlistEntryByActionReference(
    restaurantId: number,
    actionReference: string,
    status: FinalWaitlistStatus,
    readResolutionTime: () => Date,
  ): StaffWaitlistResolutionResult {
    const entry = [...this.waitlistEntries.values()].find(
      (candidate) => candidate.actionReference === actionReference,
    );
    if (
      entry === undefined ||
      entry.restaurantId !== restaurantId ||
      entry.status !== 'active' ||
      !this.restaurants.has(restaurantId)
    ) {
      return { kind: 'not-found' };
    }

    const resolved = cloneWaitlistEntry({
      ...entry,
      status,
      resolvedAt: readResolutionTime(),
    });
    try {
      this.waitlistEntries.set(entry.id, resolved);
    } catch (error: unknown) {
      this.waitlistEntries.set(entry.id, entry);
      throw error;
    }

    return { kind: 'resolved', entry: cloneWaitlistEntry(resolved) };
  }

  hasActivePhoneDuplicate(
    restaurantId: number,
    normalizedPhone: string,
  ): boolean {
    return [...this.waitlistEntries.values()].some(
      (entry) =>
        entry.restaurantId === restaurantId &&
        entry.status === 'active' &&
        entry.normalizedPhone === normalizedPhone,
    );
  }

  hasWaitlistCapabilityCollision(...capabilities: string[]): boolean {
    return [...this.waitlistEntries.values()].some((entry) =>
      capabilities.some(
        (capability) =>
          capability === entry.privateStatusToken ||
          capability === entry.actionReference,
      ),
    );
  }

  commitWaitlistJoin(
    restaurantSlug: string,
    input: WaitlistJoinInput,
  ): WaitlistJoinCommitResult {
    const restaurant = [...this.restaurants.values()].find(
      (candidate) => candidate.slug === restaurantSlug,
    );
    if (restaurant === undefined) {
      return { kind: 'not-found' };
    }
    if (
      this.hasActivePhoneDuplicate(restaurant.id, input.normalizedPhone)
    ) {
      return { kind: 'duplicate-phone' };
    }
    if (
      input.privateStatusToken === input.actionReference ||
      this.hasJoinDataCapabilityCollision(restaurant, input) ||
      this.hasWaitlistCapabilityCollision(
        input.privateStatusToken,
        input.actionReference,
      )
    ) {
      return { kind: 'capability-collision' };
    }

    const entry = cloneWaitlistEntry({
      ...input,
      id: this.nextWaitlistEntryId,
      restaurantId: restaurant.id,
      status: 'active' as const,
    });
    try {
      this.waitlistEntries.set(entry.id, entry);
    } catch (error: unknown) {
      this.waitlistEntries.delete(entry.id);
      throw error;
    }
    this.nextWaitlistEntryId += 1;

    return { kind: 'created', entry: cloneWaitlistEntry(entry) };
  }

  private hasJoinDataCapabilityCollision(
    restaurant: RestaurantRecord,
    input: WaitlistJoinInput,
  ): boolean {
    const protectedValues = [
      restaurant.slug,
      String(restaurant.id),
      input.customerName,
      input.phone,
      input.normalizedPhone,
      String(input.partySize),
      String(this.nextWaitlistEntryId),
    ];
    return [input.privateStatusToken, input.actionReference].some((capability) =>
      protectedValues.includes(capability),
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
