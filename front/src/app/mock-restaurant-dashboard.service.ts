import {
  asapScheduler,
  catchError,
  defer,
  Observable,
  observeOn,
  of,
  switchMap,
  take
} from 'rxjs';

import {
  DashboardLoadResult,
  StaffResolution,
  StaffResolutionInput,
  StaffResolutionResult,
  UNEXPECTED_ERROR_MESSAGE
} from './api-contracts';
import {
  MockCustomerWaitlistService,
  MockCustomerWaitlistTestOptions,
  MockWaitlistState
} from './mock-customer-waitlist.service';
import {
  MockRestaurantAccountService,
  MockRestaurantAccountTestOptions
} from './mock-restaurant-account.service';
import {
  CustomerWaitlistService,
  RestaurantAccountService,
  RestaurantDashboardService
} from './service-boundary';

export interface MockApplicationTestOptions extends MockCustomerWaitlistTestOptions {
  readonly initialSession?: MockRestaurantAccountTestOptions['initialSession'];
  readonly authorizedRestaurantSlug?: string;
  readonly accountService?: RestaurantAccountService;
  readonly beforeDashboardRead?: () => void;
  readonly beforeResolutionCommit?: (actionReference: string) => void;
}

export interface MockApplicationComposition {
  readonly accountService: RestaurantAccountService;
  readonly customerWaitlistService: CustomerWaitlistService;
  readonly dashboardService: RestaurantDashboardService;
}

export class MockRestaurantDashboardService implements RestaurantDashboardService {
  constructor(
    private readonly accountService: RestaurantAccountService,
    private readonly authorizedRestaurantSlug: string,
    private readonly state: MockWaitlistState,
    private readonly beforeDashboardRead: () => void,
    private readonly beforeResolutionCommit: (actionReference: string) => void
  ) {}

  loadDashboard(): Observable<DashboardLoadResult> {
    return this.authorizedOperation(() => {
      const dashboard = this.state.dashboardFor(
        this.authorizedRestaurantSlug,
        this.beforeDashboardRead
      );
      if (!dashboard) {
        throw new Error('Authorized mock restaurant is missing.');
      }
      return { kind: 'success', dashboard };
    });
  }

  resolveEntry(input: StaffResolutionInput): Observable<StaffResolutionResult> {
    return this.authorizedOperation(() => {
      if (!this.isStaffResolution(input.resolution)) {
        throw new Error('Unsupported staff resolution.');
      }
      return this.state.resolveActiveEntry(
        this.authorizedRestaurantSlug,
        input.actionReference,
        input.resolution,
        this.beforeResolutionCommit
      )
        ? { kind: 'success' }
        : { kind: 'not-found' };
    });
  }

  private authorizedOperation<Result>(operation: () => Result): Observable<Result> {
    return defer(() => this.accountService.checkDashboardAccess()).pipe(
      take(1),
      switchMap((access) => {
        if (access.kind === 'unauthorized') {
          return of({ kind: 'unauthorized' } as Result);
        }
        if (access.kind !== 'allowed') {
          return of(this.unexpected() as Result);
        }
        return defer(() => of(operation()));
      }),
      catchError(() => of(this.unexpected() as Result)),
      observeOn(asapScheduler)
    );
  }

  private isStaffResolution(value: unknown): value is StaffResolution {
    return value === 'seated' || value === 'cancelled' || value === 'no-show';
  }

  private unexpected() {
    return { kind: 'unexpected', message: UNEXPECTED_ERROR_MESSAGE } as const;
  }
}

export function createMockApplicationForTesting(
  options: MockApplicationTestOptions = {}
): MockApplicationComposition {
  const customerComposition = MockCustomerWaitlistService.createForMockComposition(options);
  const accountService = options.accountService ?? (
    options.initialSession === undefined
      ? MockRestaurantAccountService.createDefault()
      : MockRestaurantAccountService.createForTesting({ initialSession: options.initialSession })
  );
  const dashboardService = new MockRestaurantDashboardService(
    accountService,
    options.authorizedRestaurantSlug ?? 'first',
    customerComposition.state,
    options.beforeDashboardRead ?? (() => undefined),
    options.beforeResolutionCommit ?? (() => undefined)
  );

  return {
    accountService,
    customerWaitlistService: customerComposition.service,
    dashboardService
  };
}

export function createDefaultMockApplication(): MockApplicationComposition {
  return createMockApplicationForTesting({
    restaurants: [{ slug: 'demo-restaurant', restaurantName: 'Demo Restaurant' }],
    authorizedRestaurantSlug: 'demo-restaurant',
    entries: [
      {
        restaurantSlug: 'demo-restaurant',
        customerName: 'Morgan Lee',
        phone: '(555) 010-1000',
        partySize: 6,
        status: 'active',
        privateStatusToken: crypto.randomUUID()
      },
      {
        restaurantSlug: 'demo-restaurant',
        customerName: 'Sam Rivera',
        phone: '555-010-2000',
        partySize: 2,
        status: 'active',
        privateStatusToken: crypto.randomUUID()
      },
      {
        restaurantSlug: 'demo-restaurant',
        customerName: 'Alex Chen',
        phone: '555-010-3000',
        partySize: 4,
        status: 'seated',
        privateStatusToken: crypto.randomUUID()
      }
    ]
  });
}
