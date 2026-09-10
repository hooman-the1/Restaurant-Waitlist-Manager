import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { EMPTY, Observable, Subject, throwError } from 'rxjs';

import {
  ActiveEntryActionReference,
  DashboardLoadResult,
  DashboardView,
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
    ).map((row) => Array.from<HTMLElement>(row.querySelectorAll('span'))
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
    expect(fixture.nativeElement.querySelector('a, input, select, form')).toBeNull();
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
});
