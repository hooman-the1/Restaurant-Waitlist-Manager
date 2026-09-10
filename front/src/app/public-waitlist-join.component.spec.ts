import { ComponentFixture, TestBed } from '@angular/core/testing';
import {
  ActivatedRoute,
  convertToParamMap,
  ParamMap,
  Router,
  provideRouter
} from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { Title } from '@angular/platform-browser';
import { BehaviorSubject, EMPTY, NEVER, Observable, of, Subject, throwError } from 'rxjs';

import {
  JoinWaitlistResult,
  PublicWaitlistLookupResult,
  UNEXPECTED_ERROR_MESSAGE
} from './api-contracts';
import { routes } from './app.routes';
import { PublicWaitlistJoinComponent } from './public-waitlist-join.component';
import {
  CUSTOMER_WAITLIST_SERVICE,
  CustomerWaitlistService
} from './service-boundary';

describe('PublicWaitlistJoinComponent', () => {
  let fixture: ComponentFixture<PublicWaitlistJoinComponent>;
  let component: PublicWaitlistJoinComponent;
  let routeParameters: BehaviorSubject<ParamMap>;
  let waitlist: jasmine.SpyObj<CustomerWaitlistService>;
  let router: jasmine.SpyObj<Pick<Router, 'navigate' | 'navigateByUrl'>>;

  const page = () => fixture.nativeElement as HTMLElement;
  const text = () => page().textContent?.replace(/\s+/g, ' ').trim() ?? '';
  const input = (name: 'customerName' | 'phone' | 'partySize') =>
    page().querySelector<HTMLInputElement>(`input[name="${name}"]`)!;

  function configure(
    lookup: Observable<PublicWaitlistLookupResult> = NEVER,
    slug = 'Exact Slug+Case'
  ): void {
    document.title = 'Restaurant Waitlist Manager';
    routeParameters = new BehaviorSubject(convertToParamMap({ slug }));
    waitlist = jasmine.createSpyObj<CustomerWaitlistService>('CustomerWaitlistService', [
      'lookupPublicRestaurant',
      'joinWaitlist',
      'loadPrivateStatus',
      'cancelEntry'
    ]);
    waitlist.lookupPublicRestaurant.and.returnValue(lookup);
    waitlist.joinWaitlist.and.returnValue(NEVER);
    router = jasmine.createSpyObj('Router', ['navigate', 'navigateByUrl']);
    router.navigate.and.resolveTo(true);
    router.navigateByUrl.and.resolveTo(true);

    TestBed.configureTestingModule({
      imports: [PublicWaitlistJoinComponent],
      providers: [
        { provide: CUSTOMER_WAITLIST_SERVICE, useValue: waitlist },
        { provide: Router, useValue: router },
        { provide: ActivatedRoute, useValue: { paramMap: routeParameters } }
      ]
    });
  }

  function create(): void {
    fixture = TestBed.createComponent(PublicWaitlistJoinComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  }

  function makeAvailable(name = 'Café Exact'): void {
    const lookup = new Subject<PublicWaitlistLookupResult>();
    configure(lookup);
    create();
    lookup.next({ kind: 'success', restaurant: { restaurantName: name } });
    lookup.complete();
    fixture.detectChanges();
  }

  function enter(
    name: 'customerName' | 'phone' | 'partySize',
    value: string
  ): void {
    const control = input(name);
    control.value = value;
    control.dispatchEvent(new Event('input'));
    fixture.detectChanges();
  }

  function submit(): void {
    page().querySelector('form')!.dispatchEvent(new Event('submit'));
    fixture.detectChanges();
  }

  it('looks up the exact case-preserved route slug once and renders only loading while pending', () => {
    configure();
    create();
    fixture.detectChanges();

    expect(waitlist.lookupPublicRestaurant).toHaveBeenCalledOnceWith({
      restaurantSlug: 'Exact Slug+Case'
    });
    expect(text()).toBe('Loading…');
    expect(page().querySelector('h1, form, input, button, [role="alert"]')).toBeNull();
    expect(document.title).toBe('Restaurant Waitlist Manager');
  });

  it('renders the exact restaurant name as h1 and document title with one labeled template-driven form', () => {
    makeAvailable('Café & Grill');

    expect(page().querySelector('h1')?.textContent).toBe('Café & Grill');
    expect(document.title).toBe('Café & Grill');
    expect(page().querySelectorAll('form').length).toBe(1);
    expect(Array.from(page().querySelectorAll('label')).map((label) => label.textContent?.trim()))
      .toEqual(['Name', 'Phone number', 'Party size']);
    expect(page().querySelectorAll('button[type="submit"]').length).toBe(1);
    expect(page().querySelector('button')?.textContent?.trim()).toBe('Join waitlist');
  });

  it('uses no client validators and allows empty model values to reach the service boundary', () => {
    makeAvailable();
    waitlist.joinWaitlist.and.returnValue(of({ kind: 'validation', message: 'Name required.' }));

    const controls = Array.from(page().querySelectorAll('input'));
    controls.forEach((control) => {
      ['required', 'min', 'max', 'minlength', 'maxlength', 'pattern'].forEach((attribute) =>
        expect(control.hasAttribute(attribute)).withContext(attribute).toBeFalse()
      );
    });
    submit();

    expect(waitlist.joinWaitlist).toHaveBeenCalledOnceWith({
      customerName: '',
      phone: '',
      partySize: 1
    });
    expect(page().querySelector('[data-field-error]')).toBeNull();
  });

  it('submits exact strings and the numeric party-size model with only contract properties', () => {
    makeAvailable();
    waitlist.joinWaitlist.and.returnValue(NEVER);
    component.customerName = '  MiXeD   Name  ';
    component.phone = ' +98 (21) 12-34 ';
    component.partySize = 31.5;
    fixture.detectChanges();

    submit();

    expect(waitlist.joinWaitlist).toHaveBeenCalledOnceWith({
      customerName: '  MiXeD   Name  ',
      phone: ' +98 (21) 12-34 ',
      partySize: 31.5
    });
    expect(Object.keys(waitlist.joinWaitlist.calls.mostRecent().args[0])).toEqual([
      'customerName',
      'phone',
      'partySize'
    ]);
  });

  it('shows exact pending text and suppresses repeated submissions until the result arrives', () => {
    makeAvailable();
    const result = new Subject<JoinWaitlistResult>();
    waitlist.joinWaitlist.and.returnValue(result);

    submit();
    const button = page().querySelector<HTMLButtonElement>('button')!;
    expect(button.disabled).toBeTrue();
    expect(button.textContent?.trim()).toBe('Joining…');
    button.click();
    submit();
    component.submit();
    expect(waitlist.joinWaitlist).toHaveBeenCalledTimes(1);
  });

  it('shows one service validation message and preserves all exact visible values', () => {
    makeAvailable();
    waitlist.joinWaitlist.and.returnValue(
      of({ kind: 'validation', message: 'Party size is service-invalid.' })
    );
    enter('customerName', '  Name Case  ');
    enter('phone', ' +(12) 34-56 ');
    enter('partySize', '31.5');

    submit();

    expect(page().querySelectorAll('[role="alert"]').length).toBe(1);
    expect(page().querySelector('[role="alert"]')?.textContent?.trim()).toBe(
      'Party size is service-invalid.'
    );
    expect(input('customerName').value).toBe('  Name Case  ');
    expect(input('phone').value).toBe(' +(12) 34-56 ');
    expect(input('partySize').valueAsNumber).toBe(31.5);
    expect(page().querySelector<HTMLButtonElement>('button')?.disabled).toBeFalse();
  });

  it('shows the exact duplicate message while preserving values and exposing no private status data', () => {
    makeAvailable();
    waitlist.joinWaitlist.and.returnValue(of({
      kind: 'duplicate-phone',
      message: 'This phone number is already on the waitlist.'
    }));
    enter('customerName', 'Existing Name');
    enter('phone', '+1 (555) 000-1000');
    enter('partySize', '4');

    submit();

    expect(page().querySelector('[role="alert"]')?.textContent?.trim()).toBe(
      'This phone number is already on the waitlist.'
    );
    expect(input('customerName').value).toBe('Existing Name');
    expect(input('phone').value).toBe('+1 (555) 000-1000');
    expect(input('partySize').valueAsNumber).toBe(4);
    expect(router.navigate).not.toHaveBeenCalled();
    expect(page().querySelector('a')).toBeNull();
    expect(text()).not.toContain('/status/');
    expect(text()).not.toContain('private-token');
  });

  [
    ['an unexpected result', of({ kind: 'unexpected', message: UNEXPECTED_ERROR_MESSAGE } as const)],
    ['an Observable error', throwError(() => new Error('private transport detail'))],
    ['empty completion', EMPTY],
    ['an empty success token', of({ kind: 'success', privateStatusToken: '' } as const)]
  ].forEach(([description, response]) => {
    it(`recovers with the exact generic message and preserved values for ${description}`, () => {
      makeAvailable();
      waitlist.joinWaitlist.and.returnValue(response as Observable<JoinWaitlistResult>);
      enter('customerName', ' Raw Name ');
      enter('phone', ' +(12)-3 ');
      enter('partySize', '7');

      submit();

      expect(page().querySelector('[role="alert"]')?.textContent?.trim()).toBe(
        UNEXPECTED_ERROR_MESSAGE
      );
      expect(text()).not.toContain('private transport detail');
      expect(input('customerName').value).toBe(' Raw Name ');
      expect(input('phone').value).toBe(' +(12)-3 ');
      expect(input('partySize').valueAsNumber).toBe(7);
      expect(page().querySelector<HTMLButtonElement>('button')?.disabled).toBeFalse();
      expect(router.navigate).not.toHaveBeenCalled();
    });
  });

  it('routes join-time not-found to the existing generic Not Found experience', () => {
    makeAvailable();
    waitlist.joinWaitlist.and.returnValue(of({ kind: 'not-found' }));

    submit();

    expect(router.navigateByUrl).toHaveBeenCalledOnceWith('/');
    expect(component.isAvailable).toBeFalse();
    fixture.detectChanges();
    expect(page().querySelector('form')).toBeNull();
  });

  it('navigates immediately using the opaque token as one router path segment', () => {
    makeAvailable();
    waitlist.joinWaitlist.and.returnValue(
      of({ kind: 'success', privateStatusToken: 'Opaque Token+/Case' })
    );

    submit();

    expect(router.navigate).toHaveBeenCalledOnceWith(['/status', 'Opaque Token+/Case']);
    expect(router.navigateByUrl).not.toHaveBeenCalled();
    expect(text()).not.toContain('Opaque Token+/Case');
    expect(text()).not.toContain('success');
  });

  it('routes a missing lookup to Not Found and never enables a form', () => {
    configure(of({ kind: 'not-found' }));
    create();

    expect(router.navigateByUrl).toHaveBeenCalledOnceWith('/');
    expect(page().querySelector('form, button')).toBeNull();
  });

  [
    ['unexpected result', of({ kind: 'unexpected', message: UNEXPECTED_ERROR_MESSAGE } as const)],
    ['Observable error', throwError(() => new Error('raw backend detail'))],
    ['empty completion', EMPTY]
  ].forEach(([description, response]) => {
    it(`shows only the exact generic lookup failure for ${description}`, () => {
      configure(response as Observable<PublicWaitlistLookupResult>);
      create();

      expect(text()).toBe(UNEXPECTED_ERROR_MESSAGE);
      expect(page().querySelector('h1, form, input, button')).toBeNull();
      expect(text()).not.toContain('raw backend detail');
      expect(document.title).toBe('Restaurant Waitlist Manager');
    });
  });

  it('resets state/title and cancels old lookup and join when a reused route changes slug', () => {
    const firstLookup = new Subject<PublicWaitlistLookupResult>();
    const secondLookup = new Subject<PublicWaitlistLookupResult>();
    const oldJoin = new Subject<JoinWaitlistResult>();
    configure(firstLookup, 'first');
    waitlist.lookupPublicRestaurant.and.callFake(({ restaurantSlug }) =>
      restaurantSlug === 'first' ? firstLookup : secondLookup
    );
    create();
    firstLookup.next({ kind: 'success', restaurant: { restaurantName: 'First Restaurant' } });
    fixture.detectChanges();
    waitlist.joinWaitlist.and.returnValue(oldJoin);
    enter('customerName', 'Old customer');
    submit();

    routeParameters.next(convertToParamMap({ slug: 'Second Exact' }));
    fixture.detectChanges();

    expect(waitlist.lookupPublicRestaurant.calls.allArgs()).toEqual([
      [{ restaurantSlug: 'first' }],
      [{ restaurantSlug: 'Second Exact' }]
    ]);
    expect(firstLookup.observers.length).toBe(0);
    expect(oldJoin.observers.length).toBe(0);
    expect(text()).toBe('Loading…');
    expect(document.title).toBe('Restaurant Waitlist Manager');
    expect(page().querySelector('form, h1, [role="alert"]')).toBeNull();

    firstLookup.next({ kind: 'success', restaurant: { restaurantName: 'Stale Restaurant' } });
    oldJoin.next({ kind: 'success', privateStatusToken: 'stale-token' });
    oldJoin.error(new Error('stale-error'));
    secondLookup.next({ kind: 'success', restaurant: { restaurantName: 'Second Restaurant' } });
    fixture.detectChanges();

    expect(page().querySelector('h1')?.textContent).toBe('Second Restaurant');
    expect(document.title).toBe('Second Restaurant');
    expect(router.navigate).not.toHaveBeenCalled();
  });

  it('restores the pre-page title and cancels both subscriptions on teardown', () => {
    const lookup = new Subject<PublicWaitlistLookupResult>();
    const join = new Subject<JoinWaitlistResult>();
    configure(lookup);
    create();
    lookup.next({ kind: 'success', restaurant: { restaurantName: 'Temporary Title' } });
    fixture.detectChanges();
    waitlist.joinWaitlist.and.returnValue(join);
    submit();

    fixture.destroy();

    expect(document.title).toBe('Restaurant Waitlist Manager');
    expect(routeParameters.observers.length).toBe(0);
    expect(join.observers.length).toBe(0);
    join.next({ kind: 'success', privateStatusToken: 'late-token' });
    expect(router.navigate).not.toHaveBeenCalled();
  });

  it('renders none of the excluded public or customer information', () => {
    makeAvailable('Only Restaurant Name');
    const publicText = text().toLowerCase();

    [
      'restaurant email', 'account id', 'internal id', 'queue size', 'queue position',
      'estimated wait', 'join time', 'notes', 'captcha', 'qr code', 'verification',
      'customer account', 'login', 'notification', 'customization', '/status/'
    ].forEach((forbidden) => expect(publicText).not.toContain(forbidden));
    expect(page().querySelector('a, textarea, select, table')).toBeNull();
    expect(page().querySelectorAll('input').length).toBe(3);
  });
});

describe('public waitlist join route', () => {
  it('passes Angular decoded slug exactly and encodes an opaque token through router commands', async () => {
    const waitlist = jasmine.createSpyObj<CustomerWaitlistService>('CustomerWaitlistService', [
      'lookupPublicRestaurant', 'joinWaitlist', 'loadPrivateStatus', 'cancelEntry'
    ]);
    waitlist.lookupPublicRestaurant.and.returnValue(of({
      kind: 'success', restaurant: { restaurantName: 'Route Restaurant' }
    }));
    waitlist.joinWaitlist.and.returnValue(of({
      kind: 'success', privateStatusToken: 'Opaque Token+/Case'
    }));
    TestBed.configureTestingModule({
      providers: [
        provideRouter(routes),
        { provide: CUSTOMER_WAITLIST_SERVICE, useValue: waitlist }
      ]
    });
    const harness = await RouterTestingHarness.create();
    const component = await harness.navigateByUrl(
      '/restaurants/MiXeD%20Slug%2BExact',
      PublicWaitlistJoinComponent
    );

    expect(waitlist.lookupPublicRestaurant).toHaveBeenCalledOnceWith({
      restaurantSlug: 'MiXeD Slug+Exact'
    });
    component.customerName = 'Name';
    component.phone = '+1';
    component.partySize = 2;
    component.submit();
    await harness.fixture.whenStable();

    expect(TestBed.inject(Router).url).toBe('/status/Opaque%20Token%2B%2FCase');
  });
});
