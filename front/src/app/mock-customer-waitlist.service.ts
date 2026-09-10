import { asapScheduler, defer, Observable, observeOn, of } from 'rxjs';

import {
  ActiveDashboardEntry,
  ActiveEntryActionReference,
  CancelWaitlistEntryInput,
  CancelWaitlistEntryResult,
  DashboardView,
  DUPLICATE_PHONE_MESSAGE,
  FinalStatus,
  JoinWaitlistInput,
  JoinWaitlistResult,
  PrivateStatusLookupInput,
  PrivateStatusResult,
  PublicWaitlistLookupInput,
  PublicWaitlistLookupResult,
  ResolvedDashboardEntry,
  StaffResolution,
  UNEXPECTED_ERROR_MESSAGE
} from './api-contracts';
import { CustomerWaitlistService } from './service-boundary';

export interface MockRestaurantSeed {
  readonly slug: string;
  readonly restaurantName: string;
}

export interface MockCustomerWaitlistTestOptions {
  readonly restaurants?: readonly MockRestaurantSeed[];
  readonly entries?: readonly MockWaitlistEntryTestSeed[];
  readonly privateTokenGenerator?: () => string;
  readonly actionReferenceGenerator?: () => string;
  readonly beforeLookup?: (restaurantSlug: string) => void;
  readonly beforePrivateStatusLookup?: (privateStatusToken: string) => void;
  readonly beforeCancelCommit?: (privateStatusToken: string) => void;
}

type MockEntryStatus = 'active' | FinalStatus;

interface MockWaitlistEntry {
  readonly restaurantSlug: string;
  readonly restaurantName: string;
  readonly customerName: string;
  readonly phone: string;
  readonly comparisonPhone: string;
  readonly partySize: number;
  readonly status: MockEntryStatus;
  readonly insertionOrder: number;
  readonly privateStatusToken: string;
  readonly actionReference: ActiveEntryActionReference;
}

export interface MockWaitlistEntryTestSeed {
  readonly restaurantSlug: string;
  readonly customerName: string;
  readonly phone: string;
  readonly partySize: number;
  readonly status: MockEntryStatus;
  readonly privateStatusToken: string;
  readonly actionReference?: string;
}

export interface MockWaitlistEntrySnapshot {
  readonly restaurantSlug: string;
  readonly restaurantName: string;
  readonly customerName: string;
  readonly phone: string;
  readonly comparisonPhone: string;
  readonly partySize: number;
  readonly status: MockEntryStatus;
  readonly insertionOrder: number;
  readonly privateStatusToken: string;
}

export interface MockWaitlistSnapshot {
  readonly selectedRestaurantSlug: string | undefined;
  readonly entries: readonly MockWaitlistEntrySnapshot[];
}

export interface MockCustomerWaitlistComposition {
  readonly service: MockCustomerWaitlistService;
  readonly state: MockWaitlistState;
}

export class MockWaitlistState {
  private readonly restaurants = new Map<string, MockRestaurantSeed>();
  private readonly entries: MockWaitlistEntry[] = [];
  private nextInsertionOrder = 1;

  constructor(restaurants: readonly MockRestaurantSeed[]) {
    restaurants.forEach((restaurant) => {
      this.restaurants.set(restaurant.slug, { ...restaurant });
    });
  }

  restaurantBySlug(slug: string): MockRestaurantSeed | undefined {
    return this.restaurants.get(slug);
  }

  hasActivePhone(restaurantSlug: string, comparisonPhone: string): boolean {
    return this.entries.some(
      (entry) =>
        entry.restaurantSlug === restaurantSlug &&
        entry.status === 'active' &&
        entry.comparisonPhone === comparisonPhone
    );
  }

  hasPrivateToken(privateStatusToken: string): boolean {
    return this.entries.some((entry) => entry.privateStatusToken === privateStatusToken);
  }

  hasActionReference(actionReference: string): boolean {
    return this.entries.some((entry) => entry.actionReference === actionReference);
  }

  appendEntry(
    entry: Omit<MockWaitlistEntry, 'insertionOrder'>
  ): void {
    this.entries.push({ ...entry, insertionOrder: this.nextInsertionOrder });
    this.nextInsertionOrder += 1;
  }

  privateStatus(privateStatusToken: string): PrivateStatusResult {
    const entry = this.entries.find(
      (candidate) => candidate.privateStatusToken === privateStatusToken
    );
    if (!entry) {
      return { kind: 'not-found' };
    }

    if (entry.status !== 'active') {
      return {
        kind: 'resolved',
        restaurantName: entry.restaurantName,
        finalStatus: entry.status
      };
    }

    const earlierActiveEntries = this.entries.filter(
      (candidate) =>
        candidate.restaurantSlug === entry.restaurantSlug &&
        candidate.status === 'active' &&
        candidate.insertionOrder < entry.insertionOrder
    ).length;
    return {
      kind: 'active',
      restaurantName: entry.restaurantName,
      position: earlierActiveEntries + 1
    };
  }

  cancelActiveEntry(
    privateStatusToken: string,
    beforeCommit: (privateStatusToken: string) => void
  ): boolean {
    const entryIndex = this.entries.findIndex(
      (entry) =>
        entry.privateStatusToken === privateStatusToken && entry.status === 'active'
    );
    if (entryIndex < 0) {
      return false;
    }

    const cancelledEntry: MockWaitlistEntry = {
      ...this.entries[entryIndex],
      status: 'cancelled'
    };
    beforeCommit(privateStatusToken);
    this.entries[entryIndex] = cancelledEntry;
    return true;
  }

  dashboardFor(restaurantSlug: string, beforeRead: () => void): DashboardView | undefined {
    beforeRead();
    const restaurant = this.restaurants.get(restaurantSlug);
    if (!restaurant) {
      return undefined;
    }

    const activeEntries: ActiveDashboardEntry[] = this.entries
      .filter((entry) => entry.restaurantSlug === restaurantSlug && entry.status === 'active')
      .sort((left, right) => left.insertionOrder - right.insertionOrder)
      .map((entry, index) => ({
        position: index + 1,
        customerName: entry.customerName,
        phone: entry.phone,
        partySize: entry.partySize,
        actionReference: entry.actionReference
      }));
    const resolvedToday: ResolvedDashboardEntry[] = this.entries
      .filter((entry) => entry.restaurantSlug === restaurantSlug && entry.status !== 'active')
      .sort((left, right) => left.insertionOrder - right.insertionOrder)
      .map((entry) => ({
        customerName: entry.customerName,
        partySize: entry.partySize,
        finalStatus: entry.status as FinalStatus
      }));

    return {
      restaurantName: restaurant.restaurantName,
      activeEntries,
      resolvedToday
    };
  }

  resolveActiveEntry(
    restaurantSlug: string,
    actionReference: string,
    resolution: StaffResolution,
    beforeCommit: (actionReference: string) => void
  ): boolean {
    const entryIndex = this.entries.findIndex(
      (entry) =>
        entry.restaurantSlug === restaurantSlug &&
        entry.status === 'active' &&
        entry.actionReference === actionReference
    );
    if (entryIndex < 0) {
      return false;
    }

    const resolvedEntry: MockWaitlistEntry = {
      ...this.entries[entryIndex],
      status: resolution
    };
    beforeCommit(actionReference);
    this.entries[entryIndex] = resolvedEntry;
    return true;
  }

  snapshot(selectedRestaurantSlug: string | undefined): MockWaitlistSnapshot {
    return {
      selectedRestaurantSlug,
      entries: this.entries.map((entry) => ({
        restaurantSlug: entry.restaurantSlug,
        restaurantName: entry.restaurantName,
        customerName: entry.customerName,
        phone: entry.phone,
        comparisonPhone: entry.comparisonPhone,
        partySize: entry.partySize,
        status: entry.status,
        insertionOrder: entry.insertionOrder,
        privateStatusToken: entry.privateStatusToken
      }))
    };
  }
}

export class MockCustomerWaitlistService implements CustomerWaitlistService {
  private selectedRestaurantSlug: string | undefined;

  private constructor(
    private readonly state: MockWaitlistState,
    private readonly privateTokenGenerator: () => string,
    private readonly actionReferenceGenerator: () => string,
    private readonly beforeLookup: (restaurantSlug: string) => void,
    private readonly beforePrivateStatusLookup: (privateStatusToken: string) => void,
    private readonly beforeCancelCommit: (privateStatusToken: string) => void
  ) {}

  static createDefault(): MockCustomerWaitlistService {
    return new MockCustomerWaitlistService(
      new MockWaitlistState([
        { slug: 'demo-restaurant', restaurantName: 'Demo Restaurant' }
      ]),
      () => crypto.randomUUID(),
      () => crypto.randomUUID(),
      () => undefined,
      () => undefined,
      () => undefined
    );
  }

  static createForTesting(
    options: MockCustomerWaitlistTestOptions = {}
  ): MockCustomerWaitlistService {
    return MockCustomerWaitlistService.createForMockComposition(options).service;
  }

  /** Internal/test composition seam; application consumers receive only the service boundary. */
  static createForMockComposition(
    options: MockCustomerWaitlistTestOptions = {}
  ): MockCustomerWaitlistComposition {
    const state = new MockWaitlistState(options.restaurants ?? []);
    options.entries?.forEach((entry) => {
      const restaurant = state.restaurantBySlug(entry.restaurantSlug);
      if (!restaurant) {
        throw new Error('A test entry must reference a seeded restaurant.');
      }
      const actionReference = entry.actionReference ?? crypto.randomUUID();
      if (
        !entry.privateStatusToken ||
        state.hasPrivateToken(entry.privateStatusToken) ||
        state.hasActionReference(entry.privateStatusToken)
      ) {
        throw new Error('A test private token must be non-empty and unique.');
      }
      if (
        !actionReference ||
        actionReference === entry.privateStatusToken ||
        state.hasActionReference(actionReference) ||
        state.hasPrivateToken(actionReference)
      ) {
        throw new Error('A test action reference must be non-empty and unique.');
      }
      state.appendEntry({
        ...entry,
        restaurantName: restaurant.restaurantName,
        comparisonPhone: entry.phone.replace(/[ ()-]/g, ''),
        actionReference: actionReference as ActiveEntryActionReference
      });
    });

    return {
      state,
      service: new MockCustomerWaitlistService(
        state,
        options.privateTokenGenerator ?? (() => crypto.randomUUID()),
        options.actionReferenceGenerator ?? (() => crypto.randomUUID()),
        options.beforeLookup ?? (() => undefined),
        options.beforePrivateStatusLookup ?? (() => undefined),
        options.beforeCancelCommit ?? (() => undefined)
      )
    };
  }

  lookupPublicRestaurant(
    input: PublicWaitlistLookupInput
  ): Observable<PublicWaitlistLookupResult> {
    return this.oneAsyncResult(() => this.lookupResult(input));
  }

  joinWaitlist(input: JoinWaitlistInput): Observable<JoinWaitlistResult> {
    return this.oneAsyncResult(() => this.joinResult(input));
  }

  loadPrivateStatus(
    input: PrivateStatusLookupInput
  ): Observable<PrivateStatusResult> {
    return this.oneAsyncResult(() => {
      this.beforePrivateStatusLookup(input.privateToken);
      return this.state.privateStatus(input.privateToken);
    });
  }

  cancelEntry(
    input: CancelWaitlistEntryInput
  ): Observable<CancelWaitlistEntryResult> {
    return this.oneAsyncResult(() =>
      this.state.cancelActiveEntry(input.privateToken, this.beforeCancelCommit)
        ? { kind: 'cancelled' }
        : { kind: 'not-found' }
    );
  }

  /** Returns detached copies for focused tests; mutations cannot alter service state. */
  getSnapshotForTesting(): MockWaitlistSnapshot {
    return this.state.snapshot(this.selectedRestaurantSlug);
  }

  private lookupResult(input: PublicWaitlistLookupInput): PublicWaitlistLookupResult {
    this.selectedRestaurantSlug = undefined;
    this.beforeLookup(input.restaurantSlug);
    const restaurant = this.state.restaurantBySlug(input.restaurantSlug);

    if (!restaurant) {
      return { kind: 'not-found' };
    }

    this.selectedRestaurantSlug = restaurant.slug;
    return {
      kind: 'success',
      restaurant: { restaurantName: restaurant.restaurantName }
    };
  }

  private joinResult(input: JoinWaitlistInput): JoinWaitlistResult {
    if (!this.selectedRestaurantSlug) {
      return { kind: 'not-found' };
    }

    const restaurant = this.state.restaurantBySlug(this.selectedRestaurantSlug);
    if (!restaurant) {
      return { kind: 'not-found' };
    }

    if (!/\S/.test(input.customerName)) {
      return { kind: 'validation', message: 'Customer name is required.' };
    }

    const comparisonPhone = input.phone.replace(/[ ()-]/g, '');
    if (!/^\+?[0-9]+$/.test(comparisonPhone)) {
      return { kind: 'validation', message: 'Enter a valid phone number.' };
    }

    if (
      !Number.isFinite(input.partySize) ||
      !Number.isInteger(input.partySize) ||
      input.partySize < 1 ||
      input.partySize > 30
    ) {
      return { kind: 'validation', message: 'Party size must be an integer from 1 to 30.' };
    }

    if (this.state.hasActivePhone(restaurant.slug, comparisonPhone)) {
      return { kind: 'duplicate-phone', message: DUPLICATE_PHONE_MESSAGE };
    }

    const privateStatusToken = this.privateTokenGenerator();
    if (
      !privateStatusToken ||
      this.state.hasPrivateToken(privateStatusToken) ||
      this.state.hasActionReference(privateStatusToken)
    ) {
      return { kind: 'unexpected', message: UNEXPECTED_ERROR_MESSAGE };
    }

    const actionReference = this.actionReferenceGenerator();
    if (
      !actionReference ||
      actionReference === privateStatusToken ||
      this.state.hasActionReference(actionReference) ||
      this.state.hasPrivateToken(actionReference)
    ) {
      return { kind: 'unexpected', message: UNEXPECTED_ERROR_MESSAGE };
    }

    this.state.appendEntry({
      restaurantSlug: restaurant.slug,
      restaurantName: restaurant.restaurantName,
      customerName: input.customerName,
      phone: input.phone,
      comparisonPhone,
      partySize: input.partySize,
      status: 'active',
      privateStatusToken,
      actionReference: actionReference as ActiveEntryActionReference
    });

    return { kind: 'success', privateStatusToken };
  }

  private oneAsyncResult<Result>(operation: () => Result): Observable<Result> {
    return defer(() => {
      try {
        return of(operation());
      } catch {
        return of({
          kind: 'unexpected',
          message: UNEXPECTED_ERROR_MESSAGE
        } as Result);
      }
    }).pipe(observeOn(asapScheduler));
  }
}
