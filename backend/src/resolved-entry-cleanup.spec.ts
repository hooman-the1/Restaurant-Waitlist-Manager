import { INestApplication } from '@nestjs/common';
import { SchedulerRegistry } from '@nestjs/schedule';
import { Test, TestingModule } from '@nestjs/testing';
import { sign } from 'cookie-signature';
import request = require('supertest');

import { configureApplication } from './application-configuration';
import { AppModule } from './app.module';
import { DEMO_ACCESS, SystemClock } from './demo-data-seeder';
import {
  CreateWaitlistEntryInput,
  FinalWaitlistStatus,
  InMemoryStore,
  WaitlistEntryRecord,
} from './in-memory-store';
import {
  CleanupFailureReporter,
  RESOLVED_ENTRY_CLEANUP_JOB,
  ResolvedEntryCleanup,
} from './resolved-entry-cleanup';

const today = new Date(2026, 8, 12, 12, 30, 0);
const startOfToday = new Date(2026, 8, 12, 0, 0, 0, 0);

function entryInput(
  id: string,
  status: 'active' | FinalWaitlistStatus,
  timestamp: Date,
  restaurantId = 1,
): CreateWaitlistEntryInput {
  const base = {
    restaurantId,
    customerName: `Customer ${id}`,
    phone: `phone-${id}`,
    normalizedPhone: `phone${id}`,
    partySize: 2,
    privateStatusToken: `private-${id}`,
    actionReference: `action-${id}`,
    joinedAt: new Date(2020, 0, 1),
  };
  return status === 'active'
    ? { ...base, status }
    : { ...base, status, resolvedAt: new Date(timestamp) };
}

function seedRestaurant(store: InMemoryStore): void {
  store.createRestaurant({
    name: 'Test Restaurant',
    normalizedName: 'test restaurant',
    email: 'test@example.com',
    normalizedEmail: 'test@example.com',
    passwordHash: 'hash',
    slug: 'test-restaurant',
    verified: true,
    createdAt: new Date(2020, 0, 1),
  });
}

describe('InMemoryStore resolved-entry cleanup', () => {
  let store: InMemoryStore;

  beforeEach(() => {
    store = new InMemoryStore();
    seedRestaurant(store);
  });

  it('hard-deletes every old resolved status while retaining boundary, future, active, and non-expired orphan entries', () => {
    const oldStatuses: FinalWaitlistStatus[] = [
      'seated',
      'cancelled',
      'no-show',
    ];
    for (const status of oldStatuses) {
      store.createWaitlistEntry(
        entryInput(status, status, new Date(startOfToday.getTime() - 1)),
      );
    }
    const boundary = store.createWaitlistEntry(
      entryInput('boundary', 'seated', startOfToday),
    );
    const future = store.createWaitlistEntry(
      entryInput('future', 'cancelled', new Date(2026, 8, 13)),
    );
    const active = store.createWaitlistEntry(
      entryInput('old-active', 'active', new Date(2010, 0, 1)),
    );
    const oldOrphan = store.createWaitlistEntry(
      entryInput('old-orphan', 'no-show', new Date(2026, 8, 1), 999),
    );
    const currentOrphan = store.createWaitlistEntry(
      entryInput('current-orphan', 'seated', startOfToday, 999),
    );
    const activeOrphan = store.createWaitlistEntry(
      entryInput('active-orphan', 'active', new Date(2010, 0, 1), 999),
    );

    expect(store.removeResolvedWaitlistEntriesBefore(startOfToday)).toBe(4);
    for (const status of oldStatuses) {
      expect(
        store.findWaitlistEntryByPrivateStatusToken(`private-${status}`),
      ).toBeUndefined();
    }
    expect(store.findWaitlistEntryById(oldOrphan.id)).toBeUndefined();
    expect(store.findWaitlistEntryById(boundary.id)).toEqual(boundary);
    expect(store.findWaitlistEntryById(future.id)).toEqual(future);
    expect(store.findWaitlistEntryById(active.id)).toEqual(active);
    expect(store.findWaitlistEntryById(currentOrphan.id)).toEqual(currentOrphan);
    expect(store.findWaitlistEntryById(activeOrphan.id)).toEqual(activeOrphan);
    expect(store.removeResolvedWaitlistEntriesBefore(startOfToday)).toBe(0);
  });

  it('rolls the complete batch back in original FIFO order if any deletion fails', () => {
    const first = store.createWaitlistEntry(
      entryInput('first', 'seated', new Date(2026, 8, 10)),
    );
    const active = store.createWaitlistEntry(
      entryInput('active', 'active', new Date(2020, 0, 1)),
    );
    const second = store.createWaitlistEntry(
      entryInput('second', 'cancelled', new Date(2026, 8, 11)),
    );
    const entries = (
      store as unknown as {
        waitlistEntries: Map<number, WaitlistEntryRecord>;
      }
    ).waitlistEntries;
    const realDelete = entries.delete.bind(entries);
    jest
      .spyOn(entries, 'delete')
      .mockImplementationOnce(realDelete)
      .mockImplementationOnce(() => false);

    expect(() =>
      store.removeResolvedWaitlistEntriesBefore(startOfToday),
    ).toThrow('Resolved-entry cleanup failed.');
    expect(store.findWaitlistEntryById(first.id)).toEqual(first);
    expect(store.findWaitlistEntryById(second.id)).toEqual(second);
    expect(store.listActiveWaitlistEntries(1)).toEqual([
      expect.objectContaining({ id: active.id }),
    ]);
    expect([...entries.keys()]).toEqual([first.id, active.id, second.id]);

    jest.restoreAllMocks();
    expect(store.removeResolvedWaitlistEntriesBefore(startOfToday)).toBe(2);
  });

  it('does not rewind entry IDs when records are removed', () => {
    const old = store.createWaitlistEntry(
      entryInput('old', 'seated', new Date(2026, 8, 1)),
    );
    expect(store.removeResolvedWaitlistEntriesBefore(startOfToday)).toBe(1);
    expect(
      store.createWaitlistEntry(entryInput('next', 'active', today)).id,
    ).toBe(old.id + 1);
  });
});

describe('ResolvedEntryCleanup', () => {
  it('reads the clock once and uses that instant local calendar boundary', () => {
    const store = new InMemoryStore();
    const old = store.createWaitlistEntry(
      entryInput('old', 'seated', new Date(startOfToday.getTime() - 1), 999),
    );
    const boundary = store.createWaitlistEntry(
      entryInput('boundary', 'seated', startOfToday, 999),
    );
    const now = jest.fn(() => new Date(today));
    const cleanup = new ResolvedEntryCleanup(
      store,
      { now },
      { report: jest.fn() },
    );

    expect(cleanup.run()).toBe(1);
    expect(now).toHaveBeenCalledTimes(1);
    expect(store.findWaitlistEntryById(old.id)).toBeUndefined();
    expect(store.findWaitlistEntryById(boundary.id)).toEqual(boundary);
  });

  it('contains scheduled failures, reports no sensitive error detail, and permits a complete retry', () => {
    const store = new InMemoryStore();
    store.createWaitlistEntry(
      entryInput('sensitive-customer-token', 'seated', new Date(2026, 8, 1), 999),
    );
    const failure = new Error('private-sensitive-customer-token');
    const cleanupStore = jest
      .spyOn(store, 'removeResolvedWaitlistEntriesBefore')
      .mockImplementationOnce(() => {
        throw failure;
      });
    const report = jest.fn();
    const cleanup = new ResolvedEntryCleanup(
      store,
      { now: jest.fn(() => new Date(today)) },
      { report },
    );

    expect(() => cleanup.runScheduled()).not.toThrow();
    expect(report).toHaveBeenCalledWith();
    expect(JSON.stringify(report.mock.calls)).not.toContain('sensitive');
    expect(cleanup.runScheduled()).toBe(1);
    expect(cleanupStore).toHaveBeenCalledTimes(2);
  });

  it('lets startup failures reject instead of reporting and swallowing them', () => {
    const failure = new Error('clock unavailable');
    const report = jest.fn();
    const cleanup = new ResolvedEntryCleanup(
      new InMemoryStore(),
      {
        now: jest.fn(() => {
          throw failure;
        }),
      },
      { report },
    );

    expect(() => cleanup.onApplicationBootstrap()).toThrow(failure);
    expect(report).not.toHaveBeenCalled();
  });

  it('serializes duplicate and distinct-date concurrent triggers without double counting', async () => {
    const store = new InMemoryStore();
    const yesterday = store.createWaitlistEntry(
      entryInput('trigger-yesterday', 'seated', new Date(2026, 8, 11), 999),
    );
    const todayEntry = store.createWaitlistEntry(
      entryInput('trigger-today', 'cancelled', new Date(2026, 8, 12, 8), 999),
    );
    const now = jest
      .fn<Date, []>()
      .mockReturnValueOnce(new Date(2026, 8, 12, 12))
      .mockReturnValueOnce(new Date(2026, 8, 12, 18))
      .mockReturnValueOnce(new Date(2026, 8, 13, 1));
    const cleanup = new ResolvedEntryCleanup(
      store,
      { now },
      { report: jest.fn() },
    );

    const results = await Promise.all([
      Promise.resolve().then(() => cleanup.run()),
      Promise.resolve().then(() => cleanup.run()),
      Promise.resolve().then(() => cleanup.run()),
    ]);

    expect(results).toEqual([1, 0, 1]);
    expect(results.reduce((total, count) => total + count, 0)).toBe(2);
    expect(now).toHaveBeenCalledTimes(3);
    expect(store.findWaitlistEntryById(yesterday.id)).toBeUndefined();
    expect(store.findWaitlistEntryById(todayEntry.id)).toBeUndefined();
  });

  it('gives private-status and dashboard reads complete pre-cleanup or post-cleanup snapshots while a join serializes', async () => {
    const store = new InMemoryStore();
    seedRestaurant(store);
    const oldResolved = store.createWaitlistEntry(
      entryInput('snapshot-old', 'seated', new Date(2026, 8, 11)),
    );
    store.createWaitlistEntry(entryInput('snapshot-active', 'active', today));
    const currentResolved = store.createWaitlistEntry(
      entryInput('snapshot-current', 'no-show', new Date(2026, 8, 12, 8)),
    );
    const cleanup = new ResolvedEntryCleanup(
      store,
      { now: jest.fn(() => new Date(today)) },
      { report: jest.fn() },
    );
    const joinedAt = new Date(2026, 8, 12, 12, 31);

    const [statusBefore, dashboardBefore, removed, joinResult] =
      await Promise.all([
        Promise.resolve().then(() =>
          store.readPrivateWaitlistStatus(oldResolved.privateStatusToken),
        ),
        Promise.resolve().then(() =>
          store.readDashboardSnapshot(1, new Date(today)),
        ),
        Promise.resolve().then(() => cleanup.run()),
        Promise.resolve().then(() =>
          store.commitWaitlistJoin('test-restaurant', {
            customerName: 'Joined During Race',
            phone: '555-010-9090',
            normalizedPhone: '5550109090',
            partySize: 3,
            privateStatusToken: 'private-racing-join',
            actionReference: 'action-racing-join',
            joinedAt,
          }),
        ),
      ]);

    expect(statusBefore).toEqual({
      kind: 'resolved',
      restaurantName: 'Test Restaurant',
      finalStatus: 'seated',
    });
    expect(dashboardBefore).toEqual({
      restaurantName: 'Test Restaurant',
      activeEntries: [
        expect.objectContaining({ position: 1, customerName: 'Customer snapshot-active' }),
      ],
      resolvedToday: [
        expect.objectContaining({
          customerName: currentResolved.customerName,
          finalStatus: 'no-show',
        }),
      ],
    });
    expect(removed).toBe(1);
    expect(joinResult.kind).toBe('created');
    expect(
      store.readPrivateWaitlistStatus(oldResolved.privateStatusToken),
    ).toEqual({ kind: 'not-found' });
    expect(store.readDashboardSnapshot(1, new Date(today))).toEqual({
      restaurantName: 'Test Restaurant',
      activeEntries: [
        expect.objectContaining({ position: 1, customerName: 'Customer snapshot-active' }),
        expect.objectContaining({ position: 2, customerName: 'Joined During Race' }),
      ],
      resolvedToday: dashboardBefore?.resolvedToday,
    });
  });

  it('classifies customer cancellation and staff resolution committed before cleanup, while retaining transitions committed after it', async () => {
    const store = new InMemoryStore();
    seedRestaurant(store);
    const cancelBefore = store.createWaitlistEntry(
      entryInput('cancel-before', 'active', today),
    );
    const resolveBefore = store.createWaitlistEntry(
      entryInput('resolve-before', 'active', today),
    );
    const cancelAfter = store.createWaitlistEntry(
      entryInput('cancel-after', 'active', today),
    );
    const resolveAfter = store.createWaitlistEntry(
      entryInput('resolve-after', 'active', today),
    );
    const oldResolutionTime = new Date(2026, 8, 11, 23);
    const cleanup = new ResolvedEntryCleanup(
      store,
      { now: jest.fn(() => new Date(today)) },
      { report: jest.fn() },
    );

    const results = await Promise.all([
      Promise.resolve().then(() =>
        store.cancelWaitlistEntry(cancelBefore.privateStatusToken, () =>
          new Date(oldResolutionTime),
        ),
      ),
      Promise.resolve().then(() =>
        store.resolveWaitlistEntryByActionReference(
          1,
          resolveBefore.actionReference,
          'seated',
          () => new Date(oldResolutionTime),
        ),
      ),
      Promise.resolve().then(() => cleanup.run()),
      Promise.resolve().then(() =>
        store.cancelWaitlistEntry(cancelAfter.privateStatusToken, () =>
          new Date(oldResolutionTime),
        ),
      ),
      Promise.resolve().then(() =>
        store.resolveWaitlistEntryByActionReference(
          1,
          resolveAfter.actionReference,
          'no-show',
          () => new Date(oldResolutionTime),
        ),
      ),
    ]);

    expect(results).toEqual([
      expect.objectContaining({ kind: 'cancelled' }),
      expect.objectContaining({ kind: 'resolved' }),
      2,
      expect.objectContaining({ kind: 'cancelled' }),
      expect.objectContaining({ kind: 'resolved' }),
    ]);
    expect(store.readPrivateWaitlistStatus(cancelBefore.privateStatusToken)).toEqual({
      kind: 'not-found',
    });
    expect(store.readPrivateWaitlistStatus(resolveBefore.privateStatusToken)).toEqual({
      kind: 'not-found',
    });
    expect(store.readPrivateWaitlistStatus(cancelAfter.privateStatusToken)).toEqual({
      kind: 'resolved',
      restaurantName: 'Test Restaurant',
      finalStatus: 'cancelled',
    });
    expect(store.readPrivateWaitlistStatus(resolveAfter.privateStatusToken)).toEqual({
      kind: 'resolved',
      restaurantName: 'Test Restaurant',
      finalStatus: 'no-show',
    });
    expect(cleanup.run()).toBe(2);
  });
});

describe('resolved-entry cleanup lifecycle', () => {
  async function compileWithClock(
    now: jest.Mock<Date, []>,
  ): Promise<{ module: TestingModule; app: INestApplication }> {
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(SystemClock)
      .useValue({ now })
      .compile();
    const app = module.createNestApplication();
    configureApplication(app, {
      port: 8000,
      secretKey: 'cleanup-test-secret',
      frontendOrigin: 'http://localhost:4200',
    });
    return { module, app };
  }

  it('runs once after demo seeding and preserves the normal current-day seed', async () => {
    const now = jest.fn(() => new Date(today));
    const { module, app } = await compileWithClock(now);

    await app.init();

    expect(now).toHaveBeenCalledTimes(2);
    expect(module.get(InMemoryStore).listActiveWaitlistEntries(1)).toHaveLength(2);
    expect(
      module
        .get(InMemoryStore)
        .findWaitlistEntryByPrivateStatusToken(DEMO_ACCESS.resolvedPrivateStatusToken),
    ).toBeDefined();
    await app.close();
  });

  it('proves startup cleanup occurs after seeding and before initialization resolves', async () => {
    const seedYesterday = new Date(2026, 8, 11, 23, 59, 59);
    const now = jest
      .fn<Date, []>()
      .mockReturnValueOnce(seedYesterday)
      .mockReturnValueOnce(today);
    const { module, app } = await compileWithClock(now);

    await app.init();

    expect(now).toHaveBeenCalledTimes(2);
    expect(
      module
        .get(InMemoryStore)
        .findWaitlistEntryByPrivateStatusToken(DEMO_ACCESS.resolvedPrivateStatusToken),
    ).toBeUndefined();
    expect(module.get(InMemoryStore).listActiveWaitlistEntries(1)).toHaveLength(2);
    await app.close();
  });

  it('rejects bootstrap without mutating seeded state when the startup clock fails', async () => {
    const now = jest
      .fn<Date, []>()
      .mockReturnValueOnce(new Date(today))
      .mockImplementationOnce(() => {
        throw new Error('clock unavailable');
      });
    const { module, app } = await compileWithClock(now);

    await expect(app.init()).rejects.toThrow('clock unavailable');
    expect(module.get(InMemoryStore).listActiveWaitlistEntries(1)).toHaveLength(2);
    expect(module.get(InMemoryStore).listResolvedWaitlistEntries(1)).toHaveLength(1);
    await app.close();
  });

  it('rejects bootstrap and atomically restores the seed when startup deletion fails', async () => {
    const now = jest
      .fn<Date, []>()
      .mockReturnValueOnce(new Date(2026, 8, 11, 12))
      .mockReturnValueOnce(new Date(today));
    const { module, app } = await compileWithClock(now);
    const store = module.get(InMemoryStore);
    const entries = (
      store as unknown as {
        waitlistEntries: Map<number, WaitlistEntryRecord>;
      }
    ).waitlistEntries;
    jest.spyOn(entries, 'delete').mockReturnValueOnce(false);

    await expect(app.init()).rejects.toThrow('Resolved-entry cleanup failed.');
    expect([...entries.keys()]).toEqual([1, 2, 3]);
    expect(store.listActiveWaitlistEntries(1)).toHaveLength(2);
    expect(store.listResolvedWaitlistEntries(1)).toHaveLength(1);
    jest.restoreAllMocks();
    await app.close();
  });

  it('immediately invalidates removed private and staff capabilities and preserves dashboard FIFO', async () => {
    const now = jest.fn(() => new Date(today));
    const { module, app } = await compileWithClock(now);
    await app.init();
    const store = module.get(InMemoryStore);
    const expired = store.createWaitlistEntry(
      entryInput('expired-http', 'cancelled', new Date(2026, 8, 11)),
    );

    expect(module.get(ResolvedEntryCleanup).run()).toBe(1);
    await request(app.getHttpServer())
      .get(`/api/waitlist-entries/${expired.privateStatusToken}`)
      .expect(404, { kind: 'not-found' });
    const cookie = `restaurant_session=${encodeURIComponent(
      `s:${sign('demo-restaurant', 'cleanup-test-secret')}`,
    )}`;
    await request(app.getHttpServer())
      .patch(`/api/dashboard/waitlist-entries/${expired.actionReference}`)
      .set('Cookie', cookie)
      .send({ resolution: 'seated' })
      .expect(404, { kind: 'not-found' });
    const dashboard = await request(app.getHttpServer())
      .get('/api/dashboard')
      .set('Cookie', cookie)
      .expect(200);
    expect(
      dashboard.body.dashboard.activeEntries.map(
        (entry: { position: number }) => entry.position,
      ),
    ).toEqual([1, 2]);
    expect(JSON.stringify(dashboard.body)).not.toContain('expired-http');
    expect(dashboard.body.dashboard.resolvedToday).toHaveLength(1);
    await app.close();
  });

  it('uses calendar midnights without drift and stops the job on close', async () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date(2026, 2, 7, 23, 59, 59, 900));
    const now = jest.fn(() => new Date(Date.now()));
    const { module, app } = await compileWithClock(now);
    try {
      await app.init();
      const store = module.get(InMemoryStore);
      const cleanup = jest.spyOn(store, 'removeResolvedWaitlistEntriesBefore');
      const job = module
        .get(SchedulerRegistry)
        .getCronJob(RESOLVED_ENTRY_CLEANUP_JOB);

      expect(job.running).toBe(true);
      await jest.advanceTimersByTimeAsync(100);
      expect(cleanup).toHaveBeenCalledTimes(1);
      const nextLocalMidnight = new Date(2026, 2, 9).getTime();
      const timeToNextMidnight = nextLocalMidnight - Date.now();
      if (process.env.TZ === 'America/New_York') {
        expect(timeToNextMidnight).toBe(23 * 60 * 60 * 1_000);
      }
      await jest.advanceTimersByTimeAsync(timeToNextMidnight);
      expect(cleanup).toHaveBeenCalledTimes(2);

      await app.close();
      expect(job.running).toBe(false);
      await jest.advanceTimersByTimeAsync(25 * 60 * 60 * 1_000);
      expect(cleanup).toHaveBeenCalledTimes(2);
    } finally {
      jest.useRealTimers();
    }
  });
});

describe('CleanupFailureReporter', () => {
  it('emits only a stable sanitized message', () => {
    const error = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    new CleanupFailureReporter().report();
    expect(error).toHaveBeenCalledWith('Resolved-entry cleanup failed.');
    error.mockRestore();
  });
});
