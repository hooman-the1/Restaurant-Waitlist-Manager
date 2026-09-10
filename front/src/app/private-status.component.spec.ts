import { ComponentFixture, fakeAsync, TestBed, tick } from '@angular/core/testing';
import {
  ActivatedRoute,
  convertToParamMap,
  ParamMap,
  Router
} from '@angular/router';
import {
  BehaviorSubject,
  EMPTY,
  NEVER,
  Observable,
  of,
  Subject,
  throwError
} from 'rxjs';

import {
  CancelWaitlistEntryResult,
  FinalStatus,
  PrivateStatusResult,
  UNEXPECTED_ERROR_MESSAGE
} from './api-contracts';
import { PrivateStatusComponent } from './private-status.component';
import {
  CUSTOMER_WAITLIST_SERVICE,
  CustomerWaitlistService
} from './service-boundary';

describe('PrivateStatusComponent', () => {
  let fixture: ComponentFixture<PrivateStatusComponent>;
  let component: PrivateStatusComponent;
  let routeParameters: BehaviorSubject<ParamMap>;
  let waitlist: jasmine.SpyObj<CustomerWaitlistService>;
  let router: jasmine.SpyObj<Pick<Router, 'navigateByUrl'>>;

  const page = () => fixture.nativeElement as HTMLElement;
  const text = () => page().textContent?.replace(/\s+/g, ' ').trim() ?? '';

  function configure(
    lookup: Observable<PrivateStatusResult> = NEVER,
    token = 'Exact Token+Case'
  ): void {
    routeParameters = new BehaviorSubject(convertToParamMap({ token }));
    waitlist = jasmine.createSpyObj<CustomerWaitlistService>('CustomerWaitlistService', [
      'lookupPublicRestaurant',
      'joinWaitlist',
      'loadPrivateStatus',
      'cancelEntry'
    ]);
    waitlist.loadPrivateStatus.and.returnValue(lookup);
    waitlist.cancelEntry.and.returnValue(NEVER);
    router = jasmine.createSpyObj('Router', ['navigateByUrl']);
    router.navigateByUrl.and.resolveTo(true);

    TestBed.configureTestingModule({
      imports: [PrivateStatusComponent],
      providers: [
        { provide: CUSTOMER_WAITLIST_SERVICE, useValue: waitlist },
        { provide: Router, useValue: router },
        { provide: ActivatedRoute, useValue: { paramMap: routeParameters } }
      ]
    });
  }

  function create(): void {
    fixture = TestBed.createComponent(PrivateStatusComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  }

  function makeActive(
    restaurantName = 'Café & Grill',
    position = 4,
    token = 'Exact Token+Case'
  ): void {
    configure(of({ kind: 'active', restaurantName, position }), token);
    create();
  }

  function cancel(): void {
    page().querySelector<HTMLButtonElement>('button')!.click();
    fixture.detectChanges();
  }

  it('looks up the exact route token once and renders only loading while pending', () => {
    configure();
    create();
    fixture.detectChanges();

    expect(waitlist.loadPrivateStatus).toHaveBeenCalledOnceWith({
      privateToken: 'Exact Token+Case'
    });
    expect(text()).toBe('Loading…');
    expect(page().querySelector('h1, button, [role="alert"]')).toBeNull();
  });

  it('renders an active result with only the exact restaurant, position, and sole cancellation control', () => {
    makeActive('Café & Grill', 7);

    expect(page().querySelector('h1')?.textContent).toBe('Café & Grill');
    expect(page().querySelector('[data-position]')?.textContent?.trim()).toBe('#7');
    expect(page().querySelectorAll('button').length).toBe(1);
    expect(page().querySelector('button')?.textContent?.trim()).toBe('Cancel');
    expect(text()).not.toContain('Seated');
    expect(text()).not.toContain('Cancelled');
    expect(text()).not.toContain('No-show');
  });

  [
    ['seated', 'Seated'],
    ['cancelled', 'Cancelled'],
    ['no-show', 'No-show']
  ].forEach(([finalStatus, label]) => {
    it(`renders resolved ${finalStatus} as the exact plain-text label`, () => {
      configure(of({
        kind: 'resolved',
        restaurantName: 'Resolved Restaurant',
        finalStatus: finalStatus as FinalStatus
      }));
      create();

      expect(page().querySelector('h1')?.textContent).toBe('Resolved Restaurant');
      expect(page().querySelector('[data-final-status]')?.textContent?.trim()).toBe(label);
      expect(page().querySelector('button, [data-position]')).toBeNull();
    });
  });

  it('routes a not-found lookup to the generic Not Found experience after clearing private state', () => {
    configure(of({ kind: 'not-found' }));
    create();

    expect(router.navigateByUrl).toHaveBeenCalledOnceWith('/');
    expect(text()).toBe('');
    expect(page().querySelector('h1, button, [role="alert"]')).toBeNull();
  });

  [
    ['an unexpected result', of({ kind: 'unexpected', message: UNEXPECTED_ERROR_MESSAGE } as const)],
    ['an Observable error', throwError(() => new Error('private transport detail'))],
    ['empty completion', EMPTY]
  ].forEach(([description, response]) => {
    it(`shows only the generic lookup failure for ${description}`, () => {
      configure(response as Observable<PrivateStatusResult>);
      create();

      expect(text()).toBe(UNEXPECTED_ERROR_MESSAGE);
      expect(page().querySelector('h1, button, [data-position], [data-final-status]')).toBeNull();
      expect(text()).not.toContain('private transport detail');
    });
  });

  it('shows only the generic lookup failure when the service throws synchronously', () => {
    configure();
    waitlist.loadPrivateStatus.and.callFake(() => {
      throw new Error('synchronous private detail');
    });
    create();

    expect(text()).toBe(UNEXPECTED_ERROR_MESSAGE);
    expect(text()).not.toContain('synchronous private detail');
  });

  it('consumes only the first lookup result', () => {
    const lookup = new Subject<PrivateStatusResult>();
    configure(lookup);
    create();

    lookup.next({ kind: 'active', restaurantName: 'First', position: 1 });
    expect(lookup.observers.length).toBe(0);
    lookup.next({ kind: 'resolved', restaurantName: 'Late', finalStatus: 'seated' });
    fixture.detectChanges();

    expect(text()).toContain('First');
    expect(text()).not.toContain('Late');
  });

  it('cancels immediately for the displayed token and enforces one pending request', () => {
    makeActive('Active Restaurant', 3, 'Displayed Token');
    const result = new Subject<CancelWaitlistEntryResult>();
    waitlist.cancelEntry.and.returnValue(result);

    cancel();

    expect(waitlist.cancelEntry).toHaveBeenCalledOnceWith({ privateToken: 'Displayed Token' });
    expect(text()).toContain('Active Restaurant');
    expect(text()).toContain('#3');
    expect(page().querySelector<HTMLButtonElement>('button')?.disabled).toBeTrue();
    expect(page().querySelector('button')?.textContent?.trim()).toBe('Cancelling…');
    page().querySelector<HTMLButtonElement>('button')!.click();
    component.cancel();
    expect(waitlist.cancelEntry).toHaveBeenCalledTimes(1);
  });

  it('clears an earlier cancellation error as soon as a retry starts', () => {
    makeActive();
    waitlist.cancelEntry.and.returnValues(
      of({ kind: 'unexpected', message: UNEXPECTED_ERROR_MESSAGE }),
      NEVER
    );

    cancel();
    expect(page().querySelector('[role="alert"]')?.textContent?.trim()).toBe(
      UNEXPECTED_ERROR_MESSAGE
    );
    cancel();

    expect(page().querySelector('[role="alert"]')).toBeNull();
    expect(text()).toContain('Café & Grill');
    expect(text()).toContain('#4');
  });

  it('immediately replaces active state with Cancelled after cancellation succeeds', () => {
    makeActive('Same Restaurant', 2);
    waitlist.cancelEntry.and.returnValue(of({ kind: 'cancelled' }));

    cancel();

    expect(page().querySelector('h1')?.textContent).toBe('Same Restaurant');
    expect(page().querySelector('[data-final-status]')?.textContent?.trim()).toBe('Cancelled');
    expect(page().querySelector('button, [data-position], [role="alert"]')).toBeNull();
    expect(text()).not.toContain('Cancelling…');
  });

  it('routes cancellation not-found to generic Not Found with all private state cleared', () => {
    makeActive('Secret Restaurant', 9);
    waitlist.cancelEntry.and.returnValue(of({ kind: 'not-found' }));

    cancel();

    expect(router.navigateByUrl).toHaveBeenCalledOnceWith('/');
    expect(text()).toBe('');
    expect(page().querySelector('h1, button, [role="alert"]')).toBeNull();
  });

  [
    ['an unexpected result', of({ kind: 'unexpected', message: UNEXPECTED_ERROR_MESSAGE } as const)],
    ['an Observable error', throwError(() => new Error('cancel transport detail'))],
    ['empty completion', EMPTY]
  ].forEach(([description, response]) => {
    it(`retains active state and allows retry after ${description}`, fakeAsync(() => {
      makeActive('Retry Restaurant', 5);
      waitlist.cancelEntry.and.returnValue(response as Observable<CancelWaitlistEntryResult>);

      cancel();

      expect(text()).toContain('Retry Restaurant');
      expect(text()).toContain('#5');
      expect(page().querySelector('[role="alert"]')?.textContent?.trim()).toBe(
        UNEXPECTED_ERROR_MESSAGE
      );
      expect(page().querySelector<HTMLButtonElement>('button')?.disabled).toBeFalse();
      expect(text()).not.toContain('cancel transport detail');
      tick(29_999);
      expect(waitlist.loadPrivateStatus).toHaveBeenCalledTimes(1);
      tick(1);
      expect(waitlist.loadPrivateStatus).toHaveBeenCalledTimes(2);
      fixture.destroy();
    }));
  });

  it('retains active state and allows retry when cancellation throws synchronously', fakeAsync(() => {
    makeActive('Retry Restaurant', 6);
    waitlist.cancelEntry.and.callFake(() => {
      throw new Error('synchronous cancel detail');
    });

    cancel();

    expect(text()).toContain('Retry Restaurant');
    expect(text()).toContain('#6');
    expect(page().querySelector('[role="alert"]')?.textContent?.trim()).toBe(
      UNEXPECTED_ERROR_MESSAGE
    );
    expect(page().querySelector<HTMLButtonElement>('button')?.disabled).toBeFalse();
    tick(29_999);
    expect(waitlist.loadPrivateStatus).toHaveBeenCalledTimes(1);
    tick(1);
    expect(waitlist.loadPrivateStatus).toHaveBeenCalledTimes(2);
    fixture.destroy();
  }));

  it('consumes only the first cancellation result', () => {
    makeActive('First Restaurant', 1);
    const cancellation = new Subject<CancelWaitlistEntryResult>();
    waitlist.cancelEntry.and.returnValue(cancellation);
    cancel();

    cancellation.next({ kind: 'cancelled' });
    expect(cancellation.observers.length).toBe(0);
    cancellation.next({ kind: 'not-found' });
    fixture.detectChanges();

    expect(text()).toContain('Cancelled');
    expect(router.navigateByUrl).not.toHaveBeenCalled();
  });

  it('cancels old lookup and cancellation, clears state, and isolates late work on route reuse', () => {
    const firstLookup = new Subject<PrivateStatusResult>();
    const secondLookup = new Subject<PrivateStatusResult>();
    const oldCancellation = new Subject<CancelWaitlistEntryResult>();
    configure(firstLookup, 'first');
    waitlist.loadPrivateStatus.and.callFake(({ privateToken }) =>
      privateToken === 'first' ? firstLookup : secondLookup
    );
    create();
    firstLookup.next({ kind: 'active', restaurantName: 'First Restaurant', position: 8 });
    fixture.detectChanges();
    waitlist.cancelEntry.and.returnValue(oldCancellation);
    cancel();

    routeParameters.next(convertToParamMap({ token: 'Second Exact' }));
    fixture.detectChanges();

    expect(waitlist.loadPrivateStatus.calls.allArgs()).toEqual([
      [{ privateToken: 'first' }],
      [{ privateToken: 'Second Exact' }]
    ]);
    expect(firstLookup.observers.length).toBe(0);
    expect(oldCancellation.observers.length).toBe(0);
    expect(text()).toBe('Loading…');
    expect(page().querySelector('h1, button, [role="alert"]')).toBeNull();

    firstLookup.next({ kind: 'resolved', restaurantName: 'Stale lookup', finalStatus: 'seated' });
    oldCancellation.next({ kind: 'not-found' });
    oldCancellation.error(new Error('stale error'));
    secondLookup.next({ kind: 'active', restaurantName: 'Second Restaurant', position: 2 });
    fixture.detectChanges();
    waitlist.cancelEntry.and.returnValue(NEVER);
    cancel();

    expect(text()).toContain('Second Restaurant');
    expect(text()).not.toContain('Stale');
    expect(router.navigateByUrl).not.toHaveBeenCalled();
    expect(waitlist.cancelEntry.calls.mostRecent().args[0]).toEqual({
      privateToken: 'Second Exact'
    });
  });

  it('unsubscribes route, lookup, and cancellation work on teardown and ignores late work', () => {
    const lookup = new Subject<PrivateStatusResult>();
    const cancellation = new Subject<CancelWaitlistEntryResult>();
    configure(lookup);
    create();
    lookup.next({ kind: 'active', restaurantName: 'Temporary', position: 4 });
    fixture.detectChanges();
    waitlist.cancelEntry.and.returnValue(cancellation);
    cancel();

    fixture.destroy();

    expect(routeParameters.observers.length).toBe(0);
    expect(lookup.observers.length).toBe(0);
    expect(cancellation.observers.length).toBe(0);
    cancellation.next({ kind: 'not-found' });
    expect(router.navigateByUrl).not.toHaveBeenCalled();
  });

  [
    ['pending', NEVER],
    ['resolved', of({ kind: 'resolved', restaurantName: 'Done', finalStatus: 'seated' } as const)],
    ['not-found', of({ kind: 'not-found' } as const)],
    ['unexpected', of({ kind: 'unexpected', message: UNEXPECTED_ERROR_MESSAGE } as const)],
    ['Observable error', throwError(() => new Error('initial detail'))],
    ['empty completion', EMPTY]
  ].forEach(([description, response]) => {
    it(`does not create polling after an initial ${description} outcome`, fakeAsync(() => {
      configure(response as Observable<PrivateStatusResult>);
      create();

      tick(120_000);

      expect(waitlist.loadPrivateStatus).toHaveBeenCalledTimes(1);
      fixture.destroy();
    }));
  });

  it('does not create polling after a synchronous initial lookup throw', fakeAsync(() => {
    configure();
    waitlist.loadPrivateStatus.and.callFake(() => {
      throw new Error('initial synchronous detail');
    });
    create();

    tick(120_000);

    expect(waitlist.loadPrivateStatus).toHaveBeenCalledTimes(1);
    fixture.destroy();
  }));

  it('makes the first same-token automatic lookup at exactly 30 seconds', fakeAsync(() => {
    makeActive('Cadence Restaurant', 4, 'Exact Poll Token+Case');
    waitlist.loadPrivateStatus.and.returnValue(NEVER);

    tick(29_999);
    expect(waitlist.loadPrivateStatus).toHaveBeenCalledTimes(1);

    tick(1);
    expect(waitlist.loadPrivateStatus).toHaveBeenCalledTimes(2);
    expect(waitlist.loadPrivateStatus.calls.mostRecent().args[0]).toEqual({
      privateToken: 'Exact Poll Token+Case'
    });
    fixture.destroy();
  }));

  it('anchors the first tick to when an asynchronous initial active result arrives', fakeAsync(() => {
    const initial = new Subject<PrivateStatusResult>();
    configure(initial, 'delayed-active-token');
    create();
    tick(10_000);
    initial.next({ kind: 'active', restaurantName: 'Delayed Active', position: 4 });
    initial.complete();
    waitlist.loadPrivateStatus.and.returnValue(NEVER);

    tick(29_999);
    expect(waitlist.loadPrivateStatus).toHaveBeenCalledTimes(1);
    tick(1);
    expect(waitlist.loadPrivateStatus).toHaveBeenCalledTimes(2);
    fixture.destroy();
  }));

  it('keeps one fixed lookup cadence at 30, 60, and 90 seconds without calls between ticks', fakeAsync(() => {
    makeActive('Cadence Restaurant', 1);
    waitlist.loadPrivateStatus.and.returnValue(
      of({ kind: 'active', restaurantName: 'Cadence Restaurant', position: 1 })
    );

    tick(30_000);
    expect(waitlist.loadPrivateStatus).toHaveBeenCalledTimes(2);
    tick(29_999);
    expect(waitlist.loadPrivateStatus).toHaveBeenCalledTimes(2);
    tick(1);
    expect(waitlist.loadPrivateStatus).toHaveBeenCalledTimes(3);
    tick(30_000);
    expect(waitlist.loadPrivateStatus).toHaveBeenCalledTimes(4);
    fixture.destroy();
  }));

  it('skips overlapping ticks and waits for the original next cadence tick without catch-up', fakeAsync(() => {
    makeActive('Slow Restaurant', 6);
    const slowPoll = new Subject<PrivateStatusResult>();
    waitlist.loadPrivateStatus.and.returnValue(slowPoll);

    tick(30_000);
    expect(waitlist.loadPrivateStatus).toHaveBeenCalledTimes(2);
    expect(text()).toContain('Slow Restaurant');
    expect(text()).toContain('#6');
    expect(page().querySelector('button')).not.toBeNull();

    tick(60_000);
    expect(waitlist.loadPrivateStatus).toHaveBeenCalledTimes(2);
    waitlist.loadPrivateStatus.and.returnValue(NEVER);
    tick(5_000);
    slowPoll.next({ kind: 'active', restaurantName: 'Settled at 95', position: 5 });
    slowPoll.complete();
    fixture.detectChanges();
    expect(waitlist.loadPrivateStatus).toHaveBeenCalledTimes(2);

    tick(24_999);
    expect(waitlist.loadPrivateStatus).toHaveBeenCalledTimes(2);
    tick(1);
    expect(waitlist.loadPrivateStatus).toHaveBeenCalledTimes(3);
    fixture.destroy();
  }));

  it('updates active polling data and clears a prior polling error without shifting cadence', fakeAsync(() => {
    makeActive('Old Restaurant', 8);
    waitlist.loadPrivateStatus.and.returnValue(
      of({ kind: 'unexpected', message: UNEXPECTED_ERROR_MESSAGE })
    );

    tick(30_000);
    fixture.detectChanges();
    expect(text()).toContain('Old Restaurant');
    expect(text()).toContain('#8');
    expect(page().querySelector('[role="alert"]')?.textContent?.trim()).toBe(
      UNEXPECTED_ERROR_MESSAGE
    );

    waitlist.loadPrivateStatus.and.returnValue(
      of({ kind: 'active', restaurantName: 'Updated Restaurant', position: 3 })
    );
    tick(30_000);
    fixture.detectChanges();

    expect(text()).toContain('Updated Restaurant');
    expect(text()).toContain('#3');
    expect(text()).not.toContain('Old Restaurant');
    expect(page().querySelector('[role="alert"]')).toBeNull();
    expect(waitlist.loadPrivateStatus).toHaveBeenCalledTimes(3);
    fixture.destroy();
  }));

  [
    ['seated', 'Seated'],
    ['cancelled', 'Cancelled'],
    ['no-show', 'No-show']
  ].forEach(([finalStatus, label]) => {
    it(`stops permanently when polling resolves as ${finalStatus}`, fakeAsync(() => {
      makeActive('Terminal Restaurant', 2);
      waitlist.loadPrivateStatus.and.returnValue(of({
        kind: 'resolved',
        restaurantName: 'Terminal Restaurant',
        finalStatus: finalStatus as FinalStatus
      }));

      tick(30_000);
      fixture.detectChanges();

      expect(page().querySelector('[data-final-status]')?.textContent?.trim()).toBe(label);
      expect(page().querySelector('button, [data-position], [role="alert"]')).toBeNull();
      tick(120_000);
      expect(waitlist.loadPrivateStatus).toHaveBeenCalledTimes(2);
      fixture.destroy();
    }));
  });

  it('clears private state, navigates once, and stops permanently on polling not-found', fakeAsync(() => {
    makeActive('Deleted Restaurant', 10);
    const poll = new Subject<PrivateStatusResult>();
    waitlist.loadPrivateStatus.and.returnValue(poll);
    tick(30_000);

    poll.next({ kind: 'not-found' });
    poll.complete();
    fixture.detectChanges();

    expect(router.navigateByUrl).toHaveBeenCalledOnceWith('/');
    expect(text()).toBe('');
    tick(120_000);
    poll.next({ kind: 'active', restaurantName: 'Late', position: 1 });
    expect(waitlist.loadPrivateStatus).toHaveBeenCalledTimes(2);
    expect(router.navigateByUrl).toHaveBeenCalledTimes(1);
    fixture.destroy();
  }));

  [
    ['unexpected result', of({ kind: 'unexpected', message: UNEXPECTED_ERROR_MESSAGE } as const)],
    ['Observable error', throwError(() => new Error('poll transport detail'))],
    ['empty completion', EMPTY]
  ].forEach(([description, response]) => {
    it(`retains active UI and retries only on the next cadence tick after polling ${description}`, fakeAsync(() => {
      makeActive('Retry Poll Restaurant', 7);
      waitlist.loadPrivateStatus.and.returnValue(response as Observable<PrivateStatusResult>);

      tick(30_000);
      fixture.detectChanges();

      expect(text()).toContain('Retry Poll Restaurant');
      expect(text()).toContain('#7');
      expect(page().querySelector<HTMLButtonElement>('button')?.disabled).toBeFalse();
      expect(page().querySelector('[role="alert"]')?.textContent?.trim()).toBe(
        UNEXPECTED_ERROR_MESSAGE
      );
      expect(text()).not.toContain('poll transport detail');
      tick(29_999);
      expect(waitlist.loadPrivateStatus).toHaveBeenCalledTimes(2);

      waitlist.loadPrivateStatus.and.returnValue(
        of({ kind: 'active', restaurantName: 'Recovered', position: 2 })
      );
      tick(1);
      fixture.detectChanges();
      expect(waitlist.loadPrivateStatus).toHaveBeenCalledTimes(3);
      expect(text()).toContain('Recovered');
      expect(page().querySelector('[role="alert"]')).toBeNull();
      fixture.destroy();
    }));
  });

  it('retains active UI and retries on cadence after a synchronous polling throw', fakeAsync(() => {
    makeActive('Synchronous Retry', 3);
    waitlist.loadPrivateStatus.and.callFake(() => {
      throw new Error('synchronous poll detail');
    });

    tick(30_000);
    fixture.detectChanges();
    expect(text()).toContain('Synchronous Retry');
    expect(page().querySelector('[role="alert"]')?.textContent?.trim()).toBe(
      UNEXPECTED_ERROR_MESSAGE
    );
    tick(29_999);
    expect(waitlist.loadPrivateStatus).toHaveBeenCalledTimes(2);
    waitlist.loadPrivateStatus.and.returnValue(NEVER);
    tick(1);
    expect(waitlist.loadPrivateStatus).toHaveBeenCalledTimes(3);
    fixture.destroy();
  }));

  it('keeps exactly one generic feedback message across repeated polling failures', fakeAsync(() => {
    makeActive('Repeated Failure', 3);
    waitlist.loadPrivateStatus.and.returnValue(
      of({ kind: 'unexpected', message: UNEXPECTED_ERROR_MESSAGE })
    );

    tick(90_000);
    fixture.detectChanges();

    expect(waitlist.loadPrivateStatus).toHaveBeenCalledTimes(4);
    expect(page().querySelectorAll('[role="alert"]').length).toBe(1);
    expect(page().querySelector('[role="alert"]')?.textContent?.trim()).toBe(
      UNEXPECTED_ERROR_MESSAGE
    );
    fixture.destroy();
  }));

  it('invalidates a pending poll before cancellation and skips ticks until cancellation settles', fakeAsync(() => {
    makeActive('Cancellation Race', 5);
    const oldPoll = new Subject<PrivateStatusResult>();
    const cancellation = new Subject<CancelWaitlistEntryResult>();
    waitlist.loadPrivateStatus.and.returnValue(oldPoll);
    waitlist.cancelEntry.and.returnValue(cancellation);
    tick(30_000);

    cancel();

    expect(oldPoll.observers.length).toBe(0);
    expect(waitlist.cancelEntry).toHaveBeenCalledTimes(1);
    tick(60_000);
    expect(waitlist.loadPrivateStatus).toHaveBeenCalledTimes(2);
    oldPoll.next({ kind: 'not-found' });
    oldPoll.error(new Error('late poll failure'));
    expect(router.navigateByUrl).not.toHaveBeenCalled();

    cancellation.next({ kind: 'unexpected', message: UNEXPECTED_ERROR_MESSAGE });
    cancellation.complete();
    fixture.detectChanges();
    waitlist.loadPrivateStatus.and.returnValue(NEVER);
    tick(29_999);
    expect(waitlist.loadPrivateStatus).toHaveBeenCalledTimes(2);
    tick(1);
    expect(waitlist.loadPrivateStatus).toHaveBeenCalledTimes(3);
    fixture.destroy();
  }));

  [
    ['cancelled', of({ kind: 'cancelled' } as const)],
    ['not-found', of({ kind: 'not-found' } as const)]
  ].forEach(([outcome, response]) => {
    it(`stops polling permanently after cancellation ${outcome}`, fakeAsync(() => {
      makeActive('Cancel Terminal', 4);
      waitlist.cancelEntry.and.returnValue(response as Observable<CancelWaitlistEntryResult>);

      cancel();
      tick(120_000);

      expect(waitlist.loadPrivateStatus).toHaveBeenCalledTimes(1);
      fixture.destroy();
    }));
  });

  it('gives a reused active token a fresh cadence and cannot revive the old token lifecycle', fakeAsync(() => {
    const initial = new Subject<PrivateStatusResult>();
    configure(initial, 'old-token');
    waitlist.loadPrivateStatus.and.callFake(({ privateToken }) =>
      privateToken === 'old-token'
        ? initial
        : of({ kind: 'active', restaurantName: 'New Restaurant', position: 1 })
    );
    create();
    initial.next({ kind: 'active', restaurantName: 'Old Restaurant', position: 9 });
    fixture.detectChanges();
    tick(20_000);

    routeParameters.next(convertToParamMap({ token: 'New Token+Case' }));
    fixture.detectChanges();
    expect(waitlist.loadPrivateStatus).toHaveBeenCalledTimes(2);
    tick(10_000);
    expect(waitlist.loadPrivateStatus).toHaveBeenCalledTimes(2);
    tick(20_000);
    expect(waitlist.loadPrivateStatus).toHaveBeenCalledTimes(3);
    expect(waitlist.loadPrivateStatus.calls.mostRecent().args[0]).toEqual({
      privateToken: 'New Token+Case'
    });
    initial.next({ kind: 'not-found' });
    expect(router.navigateByUrl).not.toHaveBeenCalled();
    fixture.destroy();
  }));

  it('consumes only the first automatic result and permanently obeys that terminal value', fakeAsync(() => {
    makeActive('First Result', 2);
    const poll = new Subject<PrivateStatusResult>();
    waitlist.loadPrivateStatus.and.returnValue(poll);
    tick(30_000);

    poll.next({ kind: 'resolved', restaurantName: 'First Result', finalStatus: 'seated' });
    expect(poll.observers.length).toBe(0);
    poll.next({ kind: 'active', restaurantName: 'Late Result', position: 1 });
    poll.error(new Error('late terminal'));
    fixture.detectChanges();
    tick(120_000);

    expect(text()).toContain('Seated');
    expect(text()).not.toContain('Late Result');
    expect(waitlist.loadPrivateStatus).toHaveBeenCalledTimes(2);
    fixture.destroy();
  }));

  it('cancels timer and pending automatic lookup on teardown', fakeAsync(() => {
    makeActive('Destroy Restaurant', 2);
    const poll = new Subject<PrivateStatusResult>();
    waitlist.loadPrivateStatus.and.returnValue(poll);
    tick(30_000);
    expect(waitlist.loadPrivateStatus).toHaveBeenCalledTimes(2);

    fixture.destroy();
    expect(poll.observers.length).toBe(0);
    tick(120_000);
    poll.next({ kind: 'not-found' });

    expect(waitlist.loadPrivateStatus).toHaveBeenCalledTimes(2);
    expect(router.navigateByUrl).not.toHaveBeenCalled();
  }));

  it('never renders private or excluded queue data or refresh controls', () => {
    const overfullResult = {
      kind: 'active',
      restaurantName: 'Only Restaurant Name',
      position: 1,
      customerName: 'Private Customer',
      phone: '+1 555 private',
      partySize: 10,
      joinedAt: 'private join time',
      estimatedWait: 'private estimate',
      totalQueueSize: 99,
      actionReference: 'private-action-id',
      privateToken: 'private-token',
      statusUrl: '/status/private-token'
    } as unknown as PrivateStatusResult;
    configure(of(overfullResult));
    create();
    const visible = text().toLowerCase();

    [
      'private customer', '+1 555 private', 'party size', 'private join time',
      'private estimate', '99', 'private-action-id', 'private-token', '/status/',
      'you’re next', 'refresh'
    ].forEach((forbidden) => expect(visible).not.toContain(forbidden));
    expect(page().querySelectorAll('button').length).toBe(1);
    expect(page().querySelector('a, input, select, textarea')).toBeNull();
  });
});
