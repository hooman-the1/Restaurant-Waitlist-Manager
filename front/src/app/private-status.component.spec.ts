import { ComponentFixture, TestBed } from '@angular/core/testing';
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
    it(`retains active state and allows retry after ${description}`, () => {
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
    });
  });

  it('retains active state and allows retry when cancellation throws synchronously', () => {
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
  });

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
