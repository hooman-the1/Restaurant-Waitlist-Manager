import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { EMPTY, Observable, of, Subject, throwError } from 'rxjs';

import {
  ActiveEntryActionReference,
  DashboardLoadResult,
  DashboardView,
  StaffResolutionResult,
  UNEXPECTED_ERROR_MESSAGE
} from './api-contracts';
import { RestaurantDashboardComponent } from './restaurant-dashboard.component';
import {
  RESTAURANT_DASHBOARD_SERVICE,
  RestaurantDashboardService
} from './service-boundary';

describe('RestaurantDashboardComponent', () => {
  let fixture: ComponentFixture<RestaurantDashboardComponent>;
  let dashboardService: jasmine.SpyObj<RestaurantDashboardService>;
  let router: jasmine.SpyObj<Pick<Router, 'navigateByUrl'>>;

  const populatedDashboard: DashboardView = {
    restaurantName: 'North Star Cafe',
    activeEntries: [
      {
        position: 2,
        customerName: 'Morgan Lee',
        phone: '+1 (555) 010-2000',
        partySize: 6,
        actionReference: 'opaque-action-2' as ActiveEntryActionReference
      },
      {
        position: 7,
        customerName: 'Sam Rivera',
        phone: '555-010-7000',
        partySize: 2,
        actionReference: 'opaque-action-7' as ActiveEntryActionReference
      }
    ],
    resolvedToday: [
      { customerName: 'Alex Chen', partySize: 4, finalStatus: 'seated' },
      { customerName: 'Taylor Kim', partySize: 3, finalStatus: 'cancelled' },
      { customerName: 'Jordan Bell', partySize: 5, finalStatus: 'no-show' }
    ]
  };

  beforeEach(() => {
    dashboardService = jasmine.createSpyObj('RestaurantDashboardService', [
      'loadDashboard',
      'resolveEntry'
    ]);
    router = jasmine.createSpyObj('Router', ['navigateByUrl']);
    router.navigateByUrl.and.resolveTo(true);

    TestBed.configureTestingModule({
      imports: [RestaurantDashboardComponent],
      providers: [
        { provide: RESTAURANT_DASHBOARD_SERVICE, useValue: dashboardService },
        { provide: Router, useValue: router }
      ]
    });
  });

  function create(): void {
    fixture = TestBed.createComponent(RestaurantDashboardComponent);
    fixture.detectChanges();
  }

  function pageText(): string {
    return fixture.nativeElement.textContent.replace(/\s+/g, ' ').trim();
  }

  function success(dashboard: DashboardView): DashboardLoadResult {
    return { kind: 'success', dashboard };
  }

  function resolutionSuccess(): StaffResolutionResult {
    return { kind: 'success' };
  }

  function activeSelects(): HTMLSelectElement[] {
    return Array.from(
      fixture.nativeElement.querySelectorAll('[data-section="active"] select')
    );
  }

  function choose(select: HTMLSelectElement, value: string): void {
    select.value = value;
    select.dispatchEvent(new Event('change'));
    fixture.detectChanges();
  }

  it('loads once with one subscription and renders only loading while the initial request is pending', () => {
    let subscriptions = 0;
    dashboardService.loadDashboard.and.returnValue(
      new Observable<DashboardLoadResult>(() => {
        subscriptions += 1;
      })
    );

    create();
    fixture.detectChanges();
    fixture.detectChanges();

    const refresh = fixture.nativeElement.querySelector('button');
    expect(dashboardService.loadDashboard).toHaveBeenCalledTimes(1);
    expect(subscriptions).toBe(1);
    expect(pageText()).toBe('Refresh Loading…');
    expect(refresh.textContent.trim()).toBe('Refresh');
    expect(refresh.disabled).toBeTrue();
    expect(fixture.nativeElement.querySelector('h1, section, li')).toBeNull();
  });

  it('renders the exact headings, supplied FIFO order, full active fields, and plain resolved status labels', () => {
    dashboardService.loadDashboard.and.returnValue(
      new Observable((subscriber) => {
        subscriber.next(success(populatedDashboard));
        subscriber.complete();
      })
    );

    create();

    const headings = Array.from<HTMLElement>(fixture.nativeElement.querySelectorAll('h1, h2'))
      .map((heading) => heading.textContent?.trim());
    const activeRows = Array.from<HTMLElement>(
      fixture.nativeElement.querySelectorAll('[data-section="active"] li')
    ).map((row) => Array.from<HTMLElement>(row.querySelectorAll('span[data-label]'))
      .map((value) => value.textContent?.trim()));
    const resolvedRows = Array.from<HTMLElement>(
      fixture.nativeElement.querySelectorAll('[data-section="resolved"] li')
    ).map((row) => Array.from<HTMLElement>(row.querySelectorAll('span'))
      .map((value) => value.textContent?.trim()));

    expect(headings).toEqual(['North Star Cafe', 'Active', 'Resolved Today']);
    expect(activeRows).toEqual([
      ['#2', 'Morgan Lee', '+1 (555) 010-2000', '6'],
      ['#7', 'Sam Rivera', '555-010-7000', '2']
    ]);
    expect(resolvedRows).toEqual([
      ['Alex Chen', '4', 'Seated'],
      ['Taylor Kim', '3', 'Cancelled'],
      ['Jordan Bell', '5', 'No-show']
    ]);
    expect(fixture.nativeElement.querySelectorAll('h1').length).toBe(1);
    expect(pageText()).not.toContain('No customers waiting');
    expect(pageText()).not.toContain('No resolved entries today');
  });

  [
    {
      description: 'only Active is empty',
      activeEntries: [],
      resolvedToday: populatedDashboard.resolvedToday,
      present: ['No customers waiting', 'Alex Chen', 'No-show'],
      absent: ['No resolved entries today', 'Morgan Lee']
    },
    {
      description: 'only Resolved Today is empty',
      activeEntries: populatedDashboard.activeEntries,
      resolvedToday: [],
      present: ['No resolved entries today', 'Morgan Lee', '+1 (555) 010-2000'],
      absent: ['No customers waiting', 'Alex Chen']
    },
    {
      description: 'both sections are empty',
      activeEntries: [],
      resolvedToday: [],
      present: ['No customers waiting', 'No resolved entries today'],
      absent: ['Morgan Lee', 'Alex Chen']
    }
  ].forEach(({ description, activeEntries, resolvedToday, present, absent }) => {
    it(`renders independent empty states when ${description}`, () => {
      dashboardService.loadDashboard.and.returnValue(
        new Observable((subscriber) => {
          subscriber.next(success({
            restaurantName: 'North Star Cafe',
            activeEntries,
            resolvedToday
          }));
          subscriber.complete();
        })
      );

      create();

      present.forEach((value) => expect(pageText()).toContain(value));
      absent.forEach((value) => expect(pageText()).not.toContain(value));
      const sections = fixture.nativeElement.querySelectorAll('section');
      expect(sections.length).toBe(2);
      expect(sections[0].querySelector('h2').textContent.trim()).toBe('Active');
      expect(sections[1].querySelector('h2').textContent.trim()).toBe('Resolved Today');
    });
  });

  it('refreshes settled data once, hides stale data while pending, and renders the fresh result', () => {
    const refreshResult = new Subject<DashboardLoadResult>();
    dashboardService.loadDashboard.and.returnValues(
      new Observable((subscriber) => {
        subscriber.next(success(populatedDashboard));
        subscriber.complete();
      }),
      refreshResult
    );
    create();

    fixture.nativeElement.querySelector('button').click();
    fixture.detectChanges();

    expect(dashboardService.loadDashboard).toHaveBeenCalledTimes(2);
    expect(pageText()).toBe('Refresh Loading…');
    expect(fixture.nativeElement.querySelector('button').disabled).toBeTrue();
    expect(pageText()).not.toContain('North Star Cafe');
    expect(pageText()).not.toContain('Morgan Lee');

    refreshResult.next(success({
      restaurantName: 'Fresh Cafe',
      activeEntries: [],
      resolvedToday: []
    }));
    fixture.detectChanges();

    expect(pageText()).toContain('Fresh Cafe');
    expect(pageText()).not.toContain('North Star Cafe');
    expect(fixture.nativeElement.querySelector('button').disabled).toBeFalse();
  });

  it('suppresses overlapping refresh attempts while a request is pending', () => {
    const pending = new Subject<DashboardLoadResult>();
    dashboardService.loadDashboard.and.returnValue(pending);
    create();

    fixture.componentInstance.refresh();
    fixture.componentInstance.refresh();
    fixture.nativeElement.querySelector('button').click();
    fixture.detectChanges();

    expect(dashboardService.loadDashboard).toHaveBeenCalledTimes(1);
    expect(pending.observers.length).toBe(1);
  });

  it('does not accept an action against hidden data during an ordinary manual refresh', () => {
    const pending = new Subject<DashboardLoadResult>();
    dashboardService.loadDashboard.and.returnValues(of(success(populatedDashboard)), pending);
    create();

    fixture.componentInstance.refresh();
    (fixture.componentInstance as unknown as {
      resolveEntry: (reference: ActiveEntryActionReference, resolution: string) => void;
    }).resolveEntry(populatedDashboard.activeEntries[0].actionReference, 'seated');
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('select')).toBeNull();
    expect(dashboardService.resolveEntry).not.toHaveBeenCalled();
  });

  it('uses only the first emitted result and releases that request subscription', () => {
    const results = new Subject<DashboardLoadResult>();
    dashboardService.loadDashboard.and.returnValue(results);
    create();

    results.next(success(populatedDashboard));
    fixture.detectChanges();

    expect(results.observers.length).toBe(0);
    results.next(success({
      restaurantName: 'Late Cafe',
      activeEntries: [],
      resolvedToday: []
    }));
    results.error(new Error('late private failure'));
    fixture.detectChanges();

    expect(pageText()).toContain('North Star Cafe');
    expect(pageText()).not.toContain('Late Cafe');
    expect(pageText()).not.toContain('late private failure');
  });

  it('releases a pending request on destroy and ignores its later result or error', () => {
    const results = new Subject<DashboardLoadResult>();
    dashboardService.loadDashboard.and.returnValue(results);
    create();
    expect(results.observers.length).toBe(1);

    fixture.destroy();

    expect(results.observers.length).toBe(0);
    results.next(success(populatedDashboard));
    results.error(new Error('abandoned private failure'));
    expect(router.navigateByUrl).not.toHaveBeenCalled();
  });

  it('navigates an unauthorized dashboard read to the existing root fallback without data or error', () => {
    dashboardService.loadDashboard.and.returnValue(
      new Observable((subscriber) => {
        subscriber.next({ kind: 'unauthorized' });
        subscriber.complete();
      })
    );

    create();

    expect(router.navigateByUrl).toHaveBeenCalledOnceWith('/');
    expect(fixture.nativeElement.querySelector('h1, section, li')).toBeNull();
    expect(pageText()).toBe('Refresh');
    expect(pageText()).not.toContain(UNEXPECTED_ERROR_MESSAGE);
  });

  [
    ['an unexpected result', new Observable<DashboardLoadResult>((subscriber) => {
      subscriber.next({ kind: 'unexpected', message: UNEXPECTED_ERROR_MESSAGE });
      subscriber.complete();
    })],
    ['an observable error', throwError(() => new Error('private HTTP 503 detail'))],
    ['an empty completion', EMPTY]
  ].forEach(([description, response]) => {
    it(`renders only the generic error and permits retry after ${description}`, () => {
      const retry = new Subject<DashboardLoadResult>();
      dashboardService.loadDashboard.and.returnValues(
        response as Observable<DashboardLoadResult>,
        retry
      );
      create();

      expect(pageText()).toBe(`Refresh ${UNEXPECTED_ERROR_MESSAGE}`);
      expect(fixture.nativeElement.querySelector('button').disabled).toBeFalse();
      expect(pageText()).not.toContain('HTTP');
      expect(fixture.nativeElement.querySelector('h1, section, li')).toBeNull();

      fixture.nativeElement.querySelector('button').click();
      fixture.detectChanges();
      expect(dashboardService.loadDashboard).toHaveBeenCalledTimes(2);
      expect(pageText()).toBe('Refresh Loading…');
    });
  });

  it('never renders excluded data, opaque references, or staff and queue-management controls', () => {
    const dashboardWithPrivateProperties = {
      ...populatedDashboard,
      restaurantEmail: 'owner@private.example',
      publicWaitlistUrl: '/restaurants/private-url',
      totalCount: 99,
      activeEntries: [{
        ...populatedDashboard.activeEntries[0],
        joinTime: '2030-01-01T10:00:00',
        notes: 'private notes',
        privateStatusToken: 'private-status-token',
        databaseId: 314
      }],
      resolvedToday: [{
        ...populatedDashboard.resolvedToday[0],
        phone: '555-PRIVATE',
        formerPosition: 9,
        databaseId: 271
      }]
    } as unknown as DashboardView;
    dashboardService.loadDashboard.and.returnValue(
      new Observable((subscriber) => {
        subscriber.next(success(dashboardWithPrivateProperties));
        subscriber.complete();
      })
    );

    create();

    [
      'owner@private.example', '/restaurants/private-url', '99',
      '2030-01-01T10:00:00', 'private notes', 'private-status-token',
      'opaque-action-2', '314', '555-PRIVATE', '271'
    ].forEach((forbidden) => expect(pageText()).not.toContain(forbidden));
    expect(fixture.nativeElement.querySelectorAll('button').length).toBe(1);
    expect(fixture.nativeElement.querySelector('a, input, form')).toBeNull();
    expect(fixture.nativeElement.querySelectorAll('select').length).toBe(1);
    expect(dashboardService.resolveEntry).not.toHaveBeenCalled();
  });

  it('does not refresh because of rendering, time, focus, or visibility events', () => {
    dashboardService.loadDashboard.and.returnValue(
      new Observable((subscriber) => {
        subscriber.next(success(populatedDashboard));
        subscriber.complete();
      })
    );
    jasmine.clock().install();
    try {
      create();
      fixture.detectChanges();
      jasmine.clock().tick(120_000);
      window.dispatchEvent(new Event('focus'));
      document.dispatchEvent(new Event('visibilitychange'));
      fixture.detectChanges();

      expect(dashboardService.loadDashboard).toHaveBeenCalledTimes(1);
    } finally {
      jasmine.clock().uninstall();
    }
  });

  it('renders one accessible native immediate-action select for every active row only', () => {
    dashboardService.loadDashboard.and.returnValue(new Observable((subscriber) => {
      subscriber.next(success(populatedDashboard));
      subscriber.complete();
    }));

    create();

    const selects = activeSelects();
    expect(selects.length).toBe(2);
    expect(selects.map((select) => select.tagName)).toEqual(['SELECT', 'SELECT']);
    expect(selects.map((select) => select.value)).toEqual(['', '']);
    expect(selects.map((select) => Array.from(select.options).map((option) => option.text)))
      .toEqual([
        ['Choose status', 'Seated', 'Cancelled', 'No-show'],
        ['Choose status', 'Seated', 'Cancelled', 'No-show']
      ]);
    expect(selects.map((select) => select.labels?.[0]?.textContent?.trim()))
      .toEqual(['Resolve Morgan Lee', 'Resolve Sam Rivera']);
    expect(fixture.nativeElement.querySelector('[data-section="resolved"] select')).toBeNull();
  });

  it('maps each actionable choice to one immediate call with only its opaque row reference', () => {
    const references = [
      'opaque-seated' as ActiveEntryActionReference,
      'opaque-cancelled' as ActiveEntryActionReference,
      'opaque-no-show' as ActiveEntryActionReference
    ];
    dashboardService.loadDashboard.and.returnValue(of(success({
      restaurantName: 'North Star Cafe',
      activeEntries: references.map((actionReference, index) => ({
        position: index + 1,
        customerName: `Customer ${index + 1}`,
        phone: `555-010-${index + 1}000`,
        partySize: index + 2,
        actionReference
      })),
      resolvedToday: []
    })));
    const pending = [
      new Subject<StaffResolutionResult>(),
      new Subject<StaffResolutionResult>(),
      new Subject<StaffResolutionResult>()
    ];
    dashboardService.resolveEntry.and.returnValues(...pending);
    create();

    const selects = activeSelects();
    choose(selects[0], 'seated');
    choose(selects[1], 'cancelled');
    choose(selects[2], 'no-show');

    expect(dashboardService.resolveEntry.calls.allArgs()).toEqual([
      [{ actionReference: references[0], resolution: 'seated' }],
      [{ actionReference: references[1], resolution: 'cancelled' }],
      [{ actionReference: references[2], resolution: 'no-show' }]
    ]);
    expect(dashboardService.resolveEntry).toHaveBeenCalledTimes(3);
    expect(dashboardService.loadDashboard).toHaveBeenCalledTimes(1);
  });

  it('does nothing for the placeholder and suppresses repeated same-row events and direct calls', () => {
    dashboardService.loadDashboard.and.returnValue(of(success(populatedDashboard)));
    const resolution = new Subject<StaffResolutionResult>();
    dashboardService.resolveEntry.and.returnValue(resolution);
    create();

    const first = activeSelects()[0];
    choose(first, '');
    expect(dashboardService.resolveEntry).not.toHaveBeenCalled();

    choose(first, 'seated');
    first.dispatchEvent(new Event('change'));
    (fixture.componentInstance as unknown as {
      resolveEntry: (reference: ActiveEntryActionReference, resolution: string) => void;
    }).resolveEntry(populatedDashboard.activeEntries[0].actionReference, 'cancelled');
    fixture.detectChanges();

    expect(dashboardService.resolveEntry).toHaveBeenCalledTimes(1);
    expect(activeSelects()[0].disabled).toBeTrue();
    expect(activeSelects()[1].disabled).toBeFalse();
  });

  it('allows different rows concurrently, suppresses manual refresh, and coalesces reconciliation', () => {
    dashboardService.loadDashboard.and.returnValues(
      of(success(populatedDashboard)),
      of(success({
        restaurantName: 'North Star Cafe',
        activeEntries: [],
        resolvedToday: [
          ...populatedDashboard.resolvedToday,
          { customerName: 'Morgan Lee', partySize: 6, finalStatus: 'seated' },
          { customerName: 'Sam Rivera', partySize: 2, finalStatus: 'cancelled' }
        ]
      }))
    );
    const first = new Subject<StaffResolutionResult>();
    const second = new Subject<StaffResolutionResult>();
    dashboardService.resolveEntry.and.returnValues(first, second);
    create();

    choose(activeSelects()[0], 'seated');
    choose(activeSelects()[1], 'cancelled');
    fixture.componentInstance.refresh();
    fixture.nativeElement.querySelector('button').click();
    expect(dashboardService.resolveEntry).toHaveBeenCalledTimes(2);
    expect(dashboardService.loadDashboard).toHaveBeenCalledTimes(1);
    expect(fixture.nativeElement.querySelector('button').disabled).toBeTrue();

    second.next(resolutionSuccess());
    second.complete();
    fixture.detectChanges();
    expect(dashboardService.loadDashboard).toHaveBeenCalledTimes(1);
    expect(activeSelects()[0].disabled).toBeTrue();
    expect(activeSelects()[1].disabled).toBeTrue();

    first.next(resolutionSuccess());
    first.complete();
    fixture.detectChanges();
    expect(dashboardService.loadDashboard).toHaveBeenCalledTimes(2);
    expect(pageText()).not.toContain('Morgan Lee +1');
    const resolvedRows = Array.from<HTMLElement>(
      fixture.nativeElement.querySelectorAll('[data-section="resolved"] li')
    ).map((row) => Array.from<HTMLElement>(row.querySelectorAll('span'))
      .map((value) => value.textContent?.trim()));
    expect(resolvedRows).toContain(['Morgan Lee', '6', 'Seated']);
    expect(resolvedRows).toContain(['Sam Rivera', '2', 'Cancelled']);
  });

  it('retains the last dashboard and disables every action while reconciliation is pending', () => {
    const reconciliation = new Subject<DashboardLoadResult>();
    dashboardService.loadDashboard.and.returnValues(of(success(populatedDashboard)), reconciliation);
    dashboardService.resolveEntry.and.returnValue(of(resolutionSuccess()));
    create();

    choose(activeSelects()[0], 'seated');

    expect(pageText()).toContain('North Star Cafe');
    expect(pageText()).toContain('Morgan Lee');
    expect(activeSelects().every((select) => select.disabled)).toBeTrue();
    expect(fixture.nativeElement.querySelector('button').disabled).toBeTrue();
    expect(pageText()).not.toContain('Loading');
  });

  it('renders authoritative FIFO and empty-state changes after successful reconciliation', () => {
    const reconciled: DashboardView = {
      restaurantName: 'North Star Cafe',
      activeEntries: [{
        ...populatedDashboard.activeEntries[1],
        position: 1
      }],
      resolvedToday: [{ customerName: 'Morgan Lee', partySize: 6, finalStatus: 'no-show' }]
    };
    dashboardService.loadDashboard.and.returnValues(
      of(success(populatedDashboard)),
      of(success(reconciled)),
      of(success({ ...reconciled, activeEntries: [], resolvedToday: [
        ...reconciled.resolvedToday,
        { customerName: 'Sam Rivera', partySize: 2, finalStatus: 'seated' }
      ] }))
    );
    dashboardService.resolveEntry.and.returnValues(of(resolutionSuccess()), of(resolutionSuccess()));
    create();

    choose(activeSelects()[0], 'no-show');
    expect(fixture.nativeElement.querySelector('[data-section="active"] li [data-label="Position"]')
      .textContent.trim()).toBe('#1');
    expect(fixture.nativeElement.querySelector('[data-section="active"] li [data-label="Customer"]')
      .textContent.trim()).toBe('Sam Rivera');
    expect(Array.from<HTMLElement>(
      fixture.nativeElement.querySelectorAll('[data-section="resolved"] li span')
    ).map((value) => value.textContent?.trim())).toEqual(['Morgan Lee', '6', 'No-show']);
    expect(pageText()).not.toContain('No resolved entries today');

    choose(activeSelects()[0], 'seated');
    expect(pageText()).toContain('No customers waiting');
    expect(pageText()).toContain('Resolved Today');
    expect(pageText()).toContain('Sam Rivera2Seated');
  });

  [
    ['an unexpected result', of({ kind: 'unexpected', message: UNEXPECTED_ERROR_MESSAGE } as const)],
    ['an observable error', throwError(() => new Error('HTTP 500 private-token detail'))],
    ['an empty completion', EMPTY]
  ].forEach(([description, response]) => {
    it(`recovers the affected row with only the generic error after ${description}`, () => {
      dashboardService.loadDashboard.and.returnValue(of(success(populatedDashboard)));
      dashboardService.resolveEntry.and.returnValue(response as Observable<StaffResolutionResult>);
      create();

      choose(activeSelects()[0], 'seated');

      expect(pageText()).toContain(UNEXPECTED_ERROR_MESSAGE);
      expect(fixture.nativeElement.querySelector('[role="alert"]').textContent.trim())
        .toBe(UNEXPECTED_ERROR_MESSAGE);
      expect(pageText()).not.toContain('HTTP 500');
      expect(pageText()).not.toContain('private-token');
      expect(pageText()).toContain('Morgan Lee');
      expect(activeSelects()[0].value).toBe('');
      expect(activeSelects()[0].disabled).toBeFalse();
      expect(fixture.nativeElement.querySelector('button').disabled).toBeFalse();
      expect(dashboardService.loadDashboard).toHaveBeenCalledTimes(1);
    });
  });

  [
    ['returns unexpected', of({
      kind: 'unexpected',
      message: UNEXPECTED_ERROR_MESSAGE
    } as const)],
    ['fails', throwError(() => new Error('backend stale reference detail'))],
    ['completes empty', EMPTY]
  ].forEach(([description, reload]) => {
    it(`retains and locks a stale not-found row when reconciliation ${description}`, () => {
      dashboardService.loadDashboard.and.returnValues(
        of(success(populatedDashboard)),
        reload as Observable<DashboardLoadResult>,
        of(success({
          ...populatedDashboard,
          activeEntries: [populatedDashboard.activeEntries[1]]
        }))
      );
      dashboardService.resolveEntry.and.returnValue(of({ kind: 'not-found' }));
      create();

      choose(activeSelects()[0], 'cancelled');

      expect(pageText()).toContain(UNEXPECTED_ERROR_MESSAGE);
      expect(pageText()).not.toContain('backend stale reference detail');
      expect(pageText()).toContain('Morgan Lee');
      expect(activeSelects()[0].disabled).toBeTrue();
      expect(activeSelects()[1].disabled).toBeFalse();
      expect(fixture.nativeElement.querySelector('button').disabled).toBeFalse();

      fixture.nativeElement.querySelector('button').click();
      fixture.detectChanges();
      expect(pageText()).not.toContain('Morgan Lee');
      expect(pageText()).not.toContain(UNEXPECTED_ERROR_MESSAGE);
      expect(activeSelects()[0].disabled).toBeFalse();
    });
  });

  it('reconciles not-found only after other row actions settle and replaces the stale snapshot', () => {
    const first = new Subject<StaffResolutionResult>();
    const second = new Subject<StaffResolutionResult>();
    dashboardService.loadDashboard.and.returnValues(
      of(success(populatedDashboard)),
      of(success({ ...populatedDashboard, activeEntries: [] }))
    );
    dashboardService.resolveEntry.and.returnValues(first, second);
    create();

    choose(activeSelects()[0], 'seated');
    choose(activeSelects()[1], 'no-show');
    first.next({ kind: 'not-found' });
    first.complete();
    fixture.detectChanges();
    expect(dashboardService.loadDashboard).toHaveBeenCalledTimes(1);
    expect(activeSelects()[0].disabled).toBeTrue();

    second.next({ kind: 'unexpected', message: UNEXPECTED_ERROR_MESSAGE });
    second.complete();
    fixture.detectChanges();
    expect(dashboardService.loadDashboard).toHaveBeenCalledTimes(2);
    expect(pageText()).toContain('No customers waiting');
  });

  [
    ['resolution', true],
    ['reconciliation', false]
  ].forEach(([stage, unauthorizedDuringResolution]) => {
    it(`redirects without retained data or error when ${stage} is unauthorized`, () => {
      dashboardService.loadDashboard.and.returnValues(
        of(success(populatedDashboard)),
        of({ kind: 'unauthorized' })
      );
      dashboardService.resolveEntry.and.returnValue(
        of(unauthorizedDuringResolution ? { kind: 'unauthorized' } : resolutionSuccess())
      );
      create();

      choose(activeSelects()[0], 'seated');

      expect(router.navigateByUrl).toHaveBeenCalledOnceWith('/');
      expect(fixture.nativeElement.querySelector('h1, section, select')).toBeNull();
      expect(pageText()).toBe('Refresh');
      expect(pageText()).not.toContain(UNEXPECTED_ERROR_MESSAGE);
    });
  });

  [
    ['returns unexpected', of({
      kind: 'unexpected',
      message: UNEXPECTED_ERROR_MESSAGE
    } as const)],
    ['fails', throwError(() => new Error('transport/session/stack detail'))],
    ['completes empty', EMPTY]
  ].forEach(([description, reload]) => {
    it(`retains and locks a successfully acted row when reconciliation ${description}`, () => {
      dashboardService.loadDashboard.and.returnValues(
        of(success(populatedDashboard)),
        reload as Observable<DashboardLoadResult>,
        of(success({
          ...populatedDashboard,
          activeEntries: [populatedDashboard.activeEntries[1]],
          resolvedToday: [
            ...populatedDashboard.resolvedToday,
            { customerName: 'Morgan Lee', partySize: 6, finalStatus: 'seated' }
          ]
        }))
      );
      dashboardService.resolveEntry.and.returnValue(of(resolutionSuccess()));
      create();

      choose(activeSelects()[0], 'seated');

      expect(pageText()).toContain('Morgan Lee');
      expect(pageText()).toContain(UNEXPECTED_ERROR_MESSAGE);
      expect(pageText()).not.toContain('transport/session/stack detail');
      expect(activeSelects()[0].disabled).toBeTrue();
      expect(fixture.nativeElement.querySelector('button').disabled).toBeFalse();

      fixture.nativeElement.querySelector('button').click();
      fixture.detectChanges();
      expect(pageText()).not.toContain(UNEXPECTED_ERROR_MESSAGE);
      expect(pageText()).toContain('Morgan Lee6Seated');
    });
  });

  it('uses ordinary error and retry behavior after a failed recovery refresh', () => {
    dashboardService.loadDashboard.and.returnValues(
      of(success(populatedDashboard)),
      throwError(() => new Error('reconciliation detail')),
      throwError(() => new Error('manual refresh detail')),
      of(success({ ...populatedDashboard, activeEntries: [] }))
    );
    dashboardService.resolveEntry.and.returnValue(of(resolutionSuccess()));
    create();

    choose(activeSelects()[0], 'seated');
    fixture.nativeElement.querySelector('button').click();
    fixture.detectChanges();

    expect(pageText()).toBe(`Refresh ${UNEXPECTED_ERROR_MESSAGE}`);
    expect(fixture.nativeElement.querySelector('h1, section, select')).toBeNull();
    expect(pageText()).not.toContain('manual refresh detail');

    fixture.nativeElement.querySelector('button').click();
    fixture.detectChanges();
    expect(pageText()).toContain('No customers waiting');
    expect(pageText()).not.toContain(UNEXPECTED_ERROR_MESSAGE);
  });

  it('consumes only the first resolution and reconciliation results', () => {
    const resolution = new Subject<StaffResolutionResult>();
    const reconciliation = new Subject<DashboardLoadResult>();
    dashboardService.loadDashboard.and.returnValues(of(success(populatedDashboard)), reconciliation);
    dashboardService.resolveEntry.and.returnValue(resolution);
    create();

    choose(activeSelects()[0], 'seated');
    resolution.next(resolutionSuccess());
    fixture.detectChanges();
    expect(resolution.observers.length).toBe(0);
    resolution.next({ kind: 'unauthorized' });

    const finalDashboard = { ...populatedDashboard, activeEntries: [] };
    reconciliation.next(success(finalDashboard));
    fixture.detectChanges();
    expect(reconciliation.observers.length).toBe(0);
    reconciliation.next(success({ ...populatedDashboard, restaurantName: 'Late Cafe' }));
    reconciliation.error(new Error('late stack detail'));
    fixture.detectChanges();

    expect(pageText()).toContain('No customers waiting');
    expect(pageText()).not.toContain('Late Cafe');
    expect(router.navigateByUrl).not.toHaveBeenCalled();
  });

  it('releases pending resolution and reconciliation work on destroy without late effects', () => {
    const resolution = new Subject<StaffResolutionResult>();
    const reconciliation = new Subject<DashboardLoadResult>();
    dashboardService.loadDashboard.and.returnValues(of(success(populatedDashboard)), reconciliation);
    dashboardService.resolveEntry.and.returnValue(resolution);
    create();

    choose(activeSelects()[0], 'seated');
    expect(resolution.observers.length).toBe(1);
    fixture.destroy();
    expect(resolution.observers.length).toBe(0);
    resolution.next(resolutionSuccess());
    expect(dashboardService.loadDashboard).toHaveBeenCalledTimes(1);
    expect(router.navigateByUrl).not.toHaveBeenCalled();

    dashboardService.resolveEntry.and.returnValue(of(resolutionSuccess()));
    dashboardService.loadDashboard.and.returnValues(of(success(populatedDashboard)), reconciliation);
    create();
    choose(activeSelects()[0], 'cancelled');
    expect(reconciliation.observers.length).toBe(1);
    fixture.destroy();
    expect(reconciliation.observers.length).toBe(0);
    reconciliation.next({ kind: 'unauthorized' });
    expect(router.navigateByUrl).not.toHaveBeenCalled();
  });

  it('keeps action rendering private, responsive, and free of forbidden controls', () => {
    dashboardService.loadDashboard.and.returnValue(of(success(populatedDashboard)));
    create();

    const activeRows = fixture.nativeElement.querySelectorAll('[data-section="active"] li');
    expect(activeRows.length).toBe(2);
    expect(activeRows[0].querySelector('select')).not.toBeNull();
    expect(fixture.nativeElement.querySelector('[data-section="resolved"] select')).toBeNull();
    expect(fixture.nativeElement.querySelector('dialog, form, a, input, textarea')).toBeNull();
    expect(fixture.nativeElement.querySelectorAll('button').length).toBe(1);
    [
      'Apply', 'Save', 'Undo', 'Delete', 'Clear waitlist', 'Search', 'Filter',
      'Sort', 'Email', 'Public URL', 'Table', 'Notes', 'Total active'
    ].forEach((forbidden) => expect(pageText()).not.toContain(forbidden));
  });
});
