import { Injectable, OnApplicationBootstrap } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';

import { SystemClock } from './demo-data-seeder';
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
  ) {}

  onApplicationBootstrap(): void {
    this.run();
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

  @Cron(CronExpression.EVERY_DAY_AT_MIDNIGHT, {
    name: RESOLVED_ENTRY_CLEANUP_JOB,
    waitForCompletion: true,
  })
  runScheduled(): number | undefined {
    try {
      return this.run();
    } catch {
      this.failureReporter.report();
      return undefined;
    }
  }
}
