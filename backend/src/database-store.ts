import {
  Injectable,
  OnModuleDestroy,
  OnModuleInit,
  Optional,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DataSource, EntityManager } from 'typeorm';

import { createDatabaseDataSource } from './database-configuration';
import {
  RestaurantSchema,
  VerificationTokenSchema,
  WaitlistEntrySchema,
} from './database-entities';
import {
  CreateRestaurantInput,
  CreateWaitlistEntryInput,
  FinalWaitlistStatus,
  InMemoryStore,
  RestaurantRecord,
  RestaurantSignupCommitResult,
  RestaurantVerificationResult,
  ResolvedWaitlistEntryRecord,
  StaffWaitlistResolutionResult,
  StoreSnapshot,
  VerificationTokenRecord,
  WaitlistCancellationResult,
  WaitlistEntryRecord,
  WaitlistJoinCommitResult,
  WaitlistJoinInput,
} from './in-memory-store';

@Injectable()
export class DatabaseStore
  extends InMemoryStore
  implements OnModuleInit, OnModuleDestroy
{
  private dataSource?: DataSource;
  private mutationQueue: Promise<void> = Promise.resolve();

  constructor(@Optional() private readonly config?: ConfigService) {
    super();
  }

  async onModuleInit(): Promise<void> {
    const databaseUrl = this.config?.get<string>('DATABASE_URL');
    if (databaseUrl === undefined) {
      return;
    }
    this.dataSource = await createDatabaseDataSource(databaseUrl).initialize();
    super.restoreState(await this.readSnapshot());
  }

  async onModuleDestroy(): Promise<void> {
    await this.mutationQueue;
    if (this.dataSource?.isInitialized) {
      await this.dataSource.destroy();
    }
  }

  override createRestaurantPersistent(
    input: CreateRestaurantInput,
  ): Promise<RestaurantRecord> {
    return this.mutatePersistent(() => this.createRestaurant(input));
  }

  override commitRestaurantSignupPersistent(
    input: CreateRestaurantInput,
    verificationToken: string,
  ): Promise<RestaurantSignupCommitResult> {
    return this.mutatePersistent(() =>
      this.commitRestaurantSignup(input, verificationToken),
    );
  }

  override rollbackRestaurantSignupPersistent(
    restaurantId: number,
    verificationToken: string,
  ): Promise<boolean> {
    return this.mutatePersistent(() =>
      this.rollbackRestaurantSignup(restaurantId, verificationToken),
    );
  }

  override createVerificationTokenPersistent(
    token: string,
    restaurantId: number,
  ): Promise<VerificationTokenRecord> {
    return this.mutatePersistent(() =>
      this.createVerificationToken(token, restaurantId),
    );
  }

  override verifyRestaurantWithTokenPersistent(
    token: string,
  ): Promise<RestaurantVerificationResult> {
    return this.mutatePersistent(() => this.verifyRestaurantWithToken(token));
  }

  override createWaitlistEntryPersistent(
    input: CreateWaitlistEntryInput,
  ): Promise<WaitlistEntryRecord> {
    return this.mutatePersistent(() => this.createWaitlistEntry(input));
  }

  override cancelWaitlistEntryPersistent(
    token: string,
    readResolutionTime: () => Date,
  ): Promise<WaitlistCancellationResult> {
    return this.mutatePersistent(() =>
      this.cancelWaitlistEntry(token, readResolutionTime),
    );
  }

  override resolveWaitlistEntryByActionReferencePersistent(
    restaurantId: number,
    actionReference: string,
    status: FinalWaitlistStatus,
    readResolutionTime: () => Date,
  ): Promise<StaffWaitlistResolutionResult> {
    return this.mutatePersistent(() =>
      this.resolveWaitlistEntryByActionReference(
        restaurantId,
        actionReference,
        status,
        readResolutionTime,
      ),
    );
  }

  override commitWaitlistJoinPersistent(
    restaurantSlug: string,
    input: WaitlistJoinInput,
  ): Promise<WaitlistJoinCommitResult> {
    return this.mutatePersistent(() =>
      this.commitWaitlistJoin(restaurantSlug, input),
    );
  }

  override resolveWaitlistEntryPersistent(
    id: number,
    status: FinalWaitlistStatus,
    resolvedAt: Date,
  ): Promise<ResolvedWaitlistEntryRecord | undefined> {
    return this.mutatePersistent(() =>
      this.resolveWaitlistEntry(id, status, resolvedAt),
    );
  }

  override removeResolvedWaitlistEntriesBeforePersistent(
    cutoff: Date,
  ): Promise<number> {
    return this.mutatePersistent(() =>
      this.removeResolvedWaitlistEntriesBefore(cutoff),
    );
  }

  private mutatePersistent<T>(operation: () => T): Promise<T> {
    if (this.dataSource === undefined) {
      return Promise.resolve(operation());
    }

    const execute = async (): Promise<T> => {
      const before = this.snapshotState();
      try {
        const result = operation();
        await this.writeSnapshot(this.snapshotState());
        return result;
      } catch (error: unknown) {
        super.restoreState(before);
        throw error;
      }
    };
    const scheduled = this.mutationQueue.then(execute, execute);
    this.mutationQueue = scheduled.then(
      () => undefined,
      () => undefined,
    );
    return scheduled;
  }

  private async writeSnapshot(snapshot: StoreSnapshot): Promise<void> {
    const dataSource = this.requireDataSource();
    await dataSource.manager.transaction(async (manager) => {
      await this.clearTables(manager);
      if (snapshot.restaurants.length > 0) {
        await manager.getRepository(RestaurantSchema).insert(
          snapshot.restaurants.map((restaurant) => ({
            ...restaurant,
          })),
        );
      }
      if (snapshot.verificationTokens.length > 0) {
        await manager
          .getRepository(VerificationTokenSchema)
          .insert(snapshot.verificationTokens);
      }
      if (snapshot.waitlistEntries.length > 0) {
        await manager.getRepository(WaitlistEntrySchema).insert(
          snapshot.waitlistEntries.map((entry) => ({
            ...entry,
            activePhoneKey:
              entry.status === 'active' ? entry.normalizedPhone : null,
            resolvedAt: entry.status === 'active' ? null : entry.resolvedAt,
          })),
        );
      }
      await this.synchronizePostgresSequences(manager);
    });
  }

  private async synchronizePostgresSequences(
    manager: EntityManager,
  ): Promise<void> {
    if (this.requireDataSource().options.type !== 'postgres') {
      return;
    }

    for (const table of ['restaurants', 'waitlist_entries']) {
      await manager.query(
        `SELECT setval(pg_get_serial_sequence('${table}', 'id'), COALESCE(MAX(id), 1), MAX(id) IS NOT NULL) FROM "${table}"`,
      );
    }
  }

  private async clearTables(manager: EntityManager): Promise<void> {
    await manager
      .createQueryBuilder()
      .delete()
      .from(VerificationTokenSchema)
      .execute();
    await manager
      .createQueryBuilder()
      .delete()
      .from(WaitlistEntrySchema)
      .execute();
    await manager
      .createQueryBuilder()
      .delete()
      .from(RestaurantSchema)
      .execute();
  }

  private async readSnapshot(): Promise<StoreSnapshot> {
    const dataSource = this.requireDataSource();
    const [restaurants, tokens, entries] = await Promise.all([
      dataSource.getRepository(RestaurantSchema).find({ order: { id: 'ASC' } }),
      dataSource
        .getRepository(VerificationTokenSchema)
        .find({ order: { token: 'ASC' } }),
      dataSource
        .getRepository(WaitlistEntrySchema)
        .find({ order: { joinedAt: 'ASC', id: 'ASC' } }),
    ]);
    const waitlistEntries = entries.map((entry): WaitlistEntryRecord => {
      const base = {
        id: entry.id,
        restaurantId: entry.restaurantId,
        customerName: entry.customerName,
        phone: entry.phone,
        normalizedPhone: entry.normalizedPhone,
        partySize: entry.partySize,
        privateStatusToken: entry.privateStatusToken,
        actionReference: entry.actionReference,
        joinedAt: entry.joinedAt,
      };
      if (entry.status === 'active') {
        return { ...base, status: 'active' };
      }
      return {
        ...base,
        status: entry.status as FinalWaitlistStatus,
        resolvedAt: entry.resolvedAt as Date,
      };
    });

    return {
      restaurants,
      verificationTokens: tokens,
      waitlistEntries,
      nextRestaurantId:
        Math.max(0, ...restaurants.map((restaurant) => restaurant.id)) + 1,
      nextWaitlistEntryId:
        Math.max(0, ...waitlistEntries.map((entry) => entry.id)) + 1,
    };
  }

  private requireDataSource(): DataSource {
    if (this.dataSource === undefined) {
      throw new Error('Database is not initialized.');
    }
    return this.dataSource;
  }
}
