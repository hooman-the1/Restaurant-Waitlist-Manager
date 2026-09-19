import {
  Injectable,
  OnModuleDestroy,
  OnModuleInit,
  Optional,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type BetterSqlite3 from 'better-sqlite3';
import { DataSource } from 'typeorm';

import { createDatabaseDataSource } from './database-configuration';
import {
  CreateRestaurantInput,
  CreateWaitlistEntryInput,
  FinalWaitlistStatus,
  InMemoryStore,
  RestaurantSignupCommitResult,
  RestaurantVerificationResult,
  StoreSnapshot,
  UpdateRestaurantInput,
  VerificationTokenRecord,
  WaitlistCancellationResult,
  WaitlistJoinCommitResult,
  WaitlistJoinInput,
  WaitlistEntryRecord,
  RestaurantRecord,
  ResolvedWaitlistEntryRecord,
  StaffWaitlistResolutionResult,
} from './in-memory-store';

interface SqliteDriverWithConnection {
  databaseConnection: BetterSqlite3.Database;
}

@Injectable()
export class DatabaseStore
  extends InMemoryStore
  implements OnModuleInit, OnModuleDestroy
{
  private dataSource?: DataSource;
  private database?: BetterSqlite3.Database;

  constructor(@Optional() private readonly config?: ConfigService) {
    super();
  }

  async onModuleInit(): Promise<void> {
    const databaseUrl = this.config?.get<string>('DATABASE_URL');
    if (databaseUrl === undefined) {
      return;
    }
    this.dataSource = await createDatabaseDataSource(databaseUrl).initialize();
    this.database = (
      this.dataSource.driver as unknown as SqliteDriverWithConnection
    ).databaseConnection;
    super.restoreState(this.readSnapshot());
  }

  async onModuleDestroy(): Promise<void> {
    if (this.dataSource?.isInitialized) {
      await this.dataSource.destroy();
    }
  }

  override createRestaurant(input: CreateRestaurantInput): RestaurantRecord {
    return this.mutate(() => super.createRestaurant(input));
  }

  override updateRestaurant(
    id: number,
    updates: UpdateRestaurantInput,
  ): RestaurantRecord | undefined {
    return this.mutate(() => super.updateRestaurant(id, updates));
  }

  override commitRestaurantSignup(
    input: CreateRestaurantInput,
    verificationToken: string,
  ): RestaurantSignupCommitResult {
    return this.mutate(() =>
      super.commitRestaurantSignup(input, verificationToken),
    );
  }

  override rollbackRestaurantSignup(
    restaurantId: number,
    verificationToken: string,
  ): boolean {
    return this.mutate(() =>
      super.rollbackRestaurantSignup(restaurantId, verificationToken),
    );
  }

  override createVerificationToken(
    token: string,
    restaurantId: number,
  ): VerificationTokenRecord {
    return this.mutate(() =>
      super.createVerificationToken(token, restaurantId),
    );
  }

  override consumeVerificationToken(
    token: string,
  ): VerificationTokenRecord | undefined {
    return this.mutate(() => super.consumeVerificationToken(token));
  }

  override verifyRestaurantWithToken(
    token: string,
  ): RestaurantVerificationResult {
    return this.mutate(() => super.verifyRestaurantWithToken(token));
  }

  override createWaitlistEntry(
    input: CreateWaitlistEntryInput,
  ): WaitlistEntryRecord {
    return this.mutate(() => super.createWaitlistEntry(input));
  }

  override cancelWaitlistEntry(
    token: string,
    readResolutionTime: () => Date,
  ): WaitlistCancellationResult {
    return this.mutate(() =>
      super.cancelWaitlistEntry(token, readResolutionTime),
    );
  }

  override resolveWaitlistEntryByActionReference(
    restaurantId: number,
    actionReference: string,
    status: FinalWaitlistStatus,
    readResolutionTime: () => Date,
  ): StaffWaitlistResolutionResult {
    return this.mutate(() =>
      super.resolveWaitlistEntryByActionReference(
        restaurantId,
        actionReference,
        status,
        readResolutionTime,
      ),
    );
  }

  override commitWaitlistJoin(
    restaurantSlug: string,
    input: WaitlistJoinInput,
  ): WaitlistJoinCommitResult {
    return this.mutate(() => super.commitWaitlistJoin(restaurantSlug, input));
  }

  override resolveWaitlistEntry(
    id: number,
    status: FinalWaitlistStatus,
    resolvedAt: Date,
  ): ResolvedWaitlistEntryRecord | undefined {
    return this.mutate(() =>
      super.resolveWaitlistEntry(id, status, resolvedAt),
    );
  }

  override removeWaitlistEntry(id: number): boolean {
    return this.mutate(() => super.removeWaitlistEntry(id));
  }

  override removeResolvedWaitlistEntriesBefore(cutoff: Date): number {
    return this.mutate(() => super.removeResolvedWaitlistEntriesBefore(cutoff));
  }

  override reset(): void {
    super.reset();
    if (this.database !== undefined) {
      this.writeSnapshot(this.snapshotState());
    }
  }

  private mutate<T>(operation: () => T): T {
    if (this.database === undefined) {
      return operation();
    }

    const before = this.snapshotState();
    try {
      const result = operation();
      this.writeSnapshot(this.snapshotState());
      return result;
    } catch (error: unknown) {
      super.restoreState(before);
      throw error;
    }
  }

  private writeSnapshot(snapshot: StoreSnapshot): void {
    const database = this.requireDatabase();
    database.transaction(() => {
      database.prepare('DELETE FROM verification_tokens').run();
      database.prepare('DELETE FROM waitlist_entries').run();
      database.prepare('DELETE FROM restaurants').run();

      const insertRestaurant = database.prepare(
        'INSERT INTO restaurants (id, name, normalizedName, email, normalizedEmail, passwordHash, slug, verified, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      );
      for (const restaurant of snapshot.restaurants) {
        insertRestaurant.run(
          restaurant.id,
          restaurant.name,
          restaurant.normalizedName,
          restaurant.email,
          restaurant.normalizedEmail,
          restaurant.passwordHash,
          restaurant.slug,
          restaurant.verified ? 1 : 0,
          restaurant.createdAt.toISOString(),
        );
      }

      const insertToken = database.prepare(
        'INSERT INTO verification_tokens (token, restaurantId) VALUES (?, ?)',
      );
      for (const token of snapshot.verificationTokens) {
        insertToken.run(token.token, token.restaurantId);
      }

      const insertEntry = database.prepare(
        'INSERT INTO waitlist_entries (id, restaurantId, customerName, phone, normalizedPhone, activePhoneKey, partySize, privateStatusToken, actionReference, joinedAt, status, resolvedAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      );
      for (const entry of snapshot.waitlistEntries) {
        insertEntry.run(
          entry.id,
          entry.restaurantId,
          entry.customerName,
          entry.phone,
          entry.normalizedPhone,
          entry.status === 'active' ? entry.normalizedPhone : null,
          entry.partySize,
          entry.privateStatusToken,
          entry.actionReference,
          entry.joinedAt.toISOString(),
          entry.status,
          entry.status === 'active' ? null : entry.resolvedAt.toISOString(),
        );
      }
    })();
  }

  private readSnapshot(): StoreSnapshot {
    const database = this.requireDatabase();
    const restaurants = database
      .prepare('SELECT * FROM restaurants ORDER BY id')
      .all() as Array<Record<string, unknown>>;
    const tokens = database
      .prepare('SELECT * FROM verification_tokens ORDER BY token')
      .all() as Array<Record<string, unknown>>;
    const entries = database
      .prepare('SELECT * FROM waitlist_entries ORDER BY id')
      .all() as Array<Record<string, unknown>>;

    const restaurantRecords = restaurants.map((row) => ({
      id: Number(row.id),
      name: String(row.name),
      normalizedName: String(row.normalizedName),
      email: String(row.email),
      normalizedEmail: String(row.normalizedEmail),
      passwordHash: String(row.passwordHash),
      slug: String(row.slug),
      verified: Boolean(row.verified),
      createdAt: new Date(String(row.createdAt)),
    }));
    const waitlistRecords = entries.map((row): WaitlistEntryRecord => {
      const base = {
        id: Number(row.id),
        restaurantId: Number(row.restaurantId),
        customerName: String(row.customerName),
        phone: String(row.phone),
        normalizedPhone: String(row.normalizedPhone),
        partySize: Number(row.partySize),
        privateStatusToken: String(row.privateStatusToken),
        actionReference: String(row.actionReference),
        joinedAt: new Date(String(row.joinedAt)),
      };
      if (row.status === 'active') {
        return { ...base, status: 'active' };
      }
      return {
        ...base,
        status: row.status as FinalWaitlistStatus,
        resolvedAt: new Date(String(row.resolvedAt)),
      };
    });

    return {
      restaurants: restaurantRecords,
      verificationTokens: tokens.map((row) => ({
        token: String(row.token),
        restaurantId: Number(row.restaurantId),
      })),
      waitlistEntries: waitlistRecords,
      nextRestaurantId:
        Math.max(0, ...restaurantRecords.map((record) => record.id)) + 1,
      nextWaitlistEntryId:
        Math.max(0, ...waitlistRecords.map((record) => record.id)) + 1,
    };
  }

  private requireDatabase(): BetterSqlite3.Database {
    if (this.database === undefined) {
      throw new Error('Database is not initialized.');
    }
    return this.database;
  }
}
