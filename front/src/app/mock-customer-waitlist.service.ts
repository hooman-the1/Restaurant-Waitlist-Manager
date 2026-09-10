import { asapScheduler, defer, Observable, observeOn, of } from 'rxjs';

import {
  CancelWaitlistEntryInput,
  CancelWaitlistEntryResult,
  DUPLICATE_PHONE_MESSAGE,
  FinalStatus,
  JoinWaitlistInput,
  JoinWaitlistResult,
  PrivateStatusLookupInput,
  PrivateStatusResult,
  PublicWaitlistLookupInput,
  PublicWaitlistLookupResult,
  UNEXPECTED_ERROR_MESSAGE
} from './api-contracts';
import { CustomerWaitlistService } from './service-boundary';

export interface MockRestaurantSeed {
  readonly slug: string;
  readonly restaurantName: string;
}

export interface MockCustomerWaitlistTestOptions {
  readonly restaurants?: readonly MockRestaurantSeed[];
  readonly privateTokenGenerator?: () => string;
  readonly beforeLookup?: (restaurantSlug: string) => void;
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

class MockWaitlistState {
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

  appendEntry(
    entry: Omit<MockWaitlistEntry, 'insertionOrder'>
  ): void {
    this.entries.push({ ...entry, insertionOrder: this.nextInsertionOrder });
    this.nextInsertionOrder += 1;
  }

  snapshot(selectedRestaurantSlug: string | undefined): MockWaitlistSnapshot {
    return {
      selectedRestaurantSlug,
      entries: this.entries.map((entry) => ({ ...entry }))
    };
  }
}

export class MockCustomerWaitlistService implements CustomerWaitlistService {
  private selectedRestaurantSlug: string | undefined;

  private constructor(
    private readonly state: MockWaitlistState,
    private readonly privateTokenGenerator: () => string,
    private readonly beforeLookup: (restaurantSlug: string) => void
  ) {}

  static createDefault(): MockCustomerWaitlistService {
    return new MockCustomerWaitlistService(
      new MockWaitlistState([
        { slug: 'demo-restaurant', restaurantName: 'Demo Restaurant' }
      ]),
      () => crypto.randomUUID(),
      () => undefined
    );
  }

  static createForTesting(
    options: MockCustomerWaitlistTestOptions = {}
  ): MockCustomerWaitlistService {
    return new MockCustomerWaitlistService(
      new MockWaitlistState(options.restaurants ?? []),
      options.privateTokenGenerator ?? (() => crypto.randomUUID()),
      options.beforeLookup ?? (() => undefined)
    );
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
    _input: PrivateStatusLookupInput
  ): Observable<PrivateStatusResult> {
    return this.oneAsyncResult(() => ({ kind: 'not-found' }));
  }

  cancelEntry(
    _input: CancelWaitlistEntryInput
  ): Observable<CancelWaitlistEntryResult> {
    return this.oneAsyncResult(() => ({ kind: 'not-found' }));
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
    if (!privateStatusToken || this.state.hasPrivateToken(privateStatusToken)) {
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
      privateStatusToken
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
