import { Injectable, OnApplicationBootstrap, Optional } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';

import { DemoDataSeeder, SystemClock } from './demo-data-seeder';
import { InMemoryStore } from './in-memory-store';

export const RESOLVED_ENTRY_CLEANUP_JOB = 'resolved-entry-cleanup';

@Injectable()
export class CleanupFailureReporter {
  report(): void {
    console.error('Resolved-entry cleanup failed.');
  }
}

@Injectable()
export class ResolvedEntryCleanup implements OnApplicationBootstrap {
  constructor(
    private readonly store: InMemoryStore,
    private readonly clock: SystemClock,
    private readonly failureReporter: CleanupFailureReporter,
    @Optional() private readonly seeder?: DemoDataSeeder,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    await this.seeder?.seedPersistent();
    await this.runPersistent();
  }

  run(): number {
    const now = this.clock.now();
    const startOfToday = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate(),
    );
    return this.store.removeResolvedWaitlistEntriesBefore(startOfToday);
  }

  async runPersistent(): Promise<number> {
    const now = this.clock.now();
    const startOfToday = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate(),
    );
    return this.store.removeResolvedWaitlistEntriesBeforePersistent(
      startOfToday,
    );
  }

  @Cron(CronExpression.EVERY_DAY_AT_MIDNIGHT, {
    name: RESOLVED_ENTRY_CLEANUP_JOB,
    waitForCompletion: true,
  })
  async runScheduled(): Promise<number | undefined> {
    try {
      return await this.runPersistent();
    } catch {
      this.failureReporter.report();
      return undefined;
    }
  }
}
