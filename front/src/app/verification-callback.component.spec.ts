import { ComponentFixture, TestBed } from '@angular/core/testing';
import {
  ActivatedRoute,
  convertToParamMap,
  ParamMap,
  Router
} from '@angular/router';
import { BehaviorSubject, EMPTY, Observable, Subject, throwError } from 'rxjs';

import { UNEXPECTED_ERROR_MESSAGE, VerificationResult } from './api-contracts';
import { RestaurantAccountService, RESTAURANT_ACCOUNT_SERVICE } from './service-boundary';
import { VerificationCallbackComponent } from './verification-callback.component';

describe('VerificationCallbackComponent', () => {
  let fixture: ComponentFixture<VerificationCallbackComponent>;
  let routeParameters: BehaviorSubject<ParamMap>;
  let account: jasmine.SpyObj<Pick<RestaurantAccountService, 'verify'>>;
  let router: jasmine.SpyObj<Pick<Router, 'navigateByUrl'>>;

  function render(token = 'Opaque Token+Case'): void {
    routeParameters = new BehaviorSubject(convertToParamMap({ token }));
    account = jasmine.createSpyObj('RestaurantAccountService', ['verify']);
    router = jasmine.createSpyObj('Router', ['navigateByUrl']);
    router.navigateByUrl.and.resolveTo(true);

    TestBed.configureTestingModule({
      imports: [VerificationCallbackComponent],
      providers: [
        { provide: ActivatedRoute, useValue: { paramMap: routeParameters } },
        { provide: RESTAURANT_ACCOUNT_SERVICE, useValue: account },
        { provide: Router, useValue: router }
      ]
    });
  }

  function create(): void {
    fixture = TestBed.createComponent(VerificationCallbackComponent);
    fixture.detectChanges();
  }

  function pageText(): string {
    return fixture.nativeElement.textContent.trim();
  }

  it('passes the exact Angular route token to one service call and one subscription despite repeated rendering', () => {
    let subscriptions = 0;
    accountSubscriptionSetup(() =>
      new Observable<VerificationResult>(() => {
        subscriptions += 1;
      })
    );

    create();
    fixture.detectChanges();
    fixture.detectChanges();

    expect(account.verify).toHaveBeenCalledOnceWith({ token: 'Opaque Token+Case' });
    expect(subscriptions).toBe(1);
    expect(pageText()).toBe('Verifying…');
  });

  it('renders only the pending state while the current verification is unsettled', () => {
    accountSubscriptionSetup(() => new Subject<VerificationResult>());

    create();

    expect(pageText()).toBe('Verifying…');
    expect(fixture.nativeElement.querySelector('button, a, input, form')).toBeNull();
    expect(pageText()).not.toContain('invalid');
    expect(pageText()).not.toContain(UNEXPECTED_ERROR_MESSAGE);
    expect(pageText()).not.toContain('success');
    expect(pageText()).not.toContain('Dashboard');
  });

  it('returns to pending for a reused-component token change and prevents the stale request from winning', () => {
    const first = new Subject<VerificationResult>();
    const second = new Subject<VerificationResult>();
    accountSubscriptionSetup(
      ({ token }) => token === 'first-token' ? first : second,
      'first-token'
    );
    create();
    first.next({ kind: 'invalid-or-used-token' });
    fixture.detectChanges();
    expect(pageText()).toBe('This verification link is invalid or has already been used.');

    routeParameters.next(convertToParamMap({ token: 'Second Exact Token' }));
    fixture.detectChanges();

    expect(account.verify.calls.allArgs()).toEqual([
      [{ token: 'first-token' }],
      [{ token: 'Second Exact Token' }]
    ]);
    expect(first.observers.length).toBe(0);
    expect(second.observers.length).toBe(1);
    expect(pageText()).toBe('Verifying…');

    first.next({ kind: 'success' });
    first.error(new Error('late private failure'));
    second.next({ kind: 'invalid-or-used-token' });
    fixture.detectChanges();

    expect(router.navigateByUrl).not.toHaveBeenCalled();
    expect(pageText()).toBe('This verification link is invalid or has already been used.');
  });

  it('navigates directly to the dashboard on success without rendering a success transition', () => {
    const result = new Subject<VerificationResult>();
    accountSubscriptionSetup(() => result);
    create();

    result.next({ kind: 'success' });
    fixture.detectChanges();

    expect(router.navigateByUrl).toHaveBeenCalledOnceWith('/dashboard');
    expect(pageText()).toBe('Verifying…');
    expect(fixture.nativeElement.querySelector('button, a')).toBeNull();
  });

  ['unknown-token', 'already-used-token'].forEach((token) => {
    it(`shows the exact invalid/used message without navigation for ${token}`, () => {
      accountSubscriptionSetup(() => new Observable((subscriber) => {
        subscriber.next({ kind: 'invalid-or-used-token' });
        subscriber.complete();
      }), token);
      create();

      expect(pageText()).toBe('This verification link is invalid or has already been used.');
      expect(router.navigateByUrl).not.toHaveBeenCalled();
      expect(fixture.nativeElement.querySelector('button, a, input, form')).toBeNull();
    });
  });

  [
    ['an application unexpected result', new Observable<VerificationResult>((subscriber) => {
      subscriber.next({ kind: 'unexpected', message: UNEXPECTED_ERROR_MESSAGE });
      subscriber.complete();
    })],
    ['an observable error', throwError(() => new Error('private transport detail'))],
    ['an empty completion', EMPTY]
  ].forEach(([description, result]) => {
    it(`shows only the generic fallback for ${description}`, () => {
      accountSubscriptionSetup(() => result as Observable<VerificationResult>);
      create();

      expect(pageText()).toBe(UNEXPECTED_ERROR_MESSAGE);
      expect(router.navigateByUrl).not.toHaveBeenCalled();
      expect(fixture.nativeElement.querySelector('button, a, input, form')).toBeNull();
      expect(pageText()).not.toContain('private transport detail');
      expect(pageText()).not.toContain('Verifying');
    });
  });

  function accountSubscriptionSetup(
    response: Parameters<jasmine.Spy<RestaurantAccountService['verify']>['and']['callFake']>[0],
    token = 'Opaque Token+Case'
  ): void {
    render(token);
    account.verify.and.callFake(response);
  }
});
