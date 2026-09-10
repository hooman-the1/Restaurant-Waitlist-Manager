import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { Observable, of, Subject, throwError } from 'rxjs';

import { RestaurantSignupResult } from './api-contracts';
import { routes } from './app.routes';
import { RestaurantSignupComponent } from './restaurant-signup.component';
import {
  RESTAURANT_ACCOUNT_SERVICE,
  RestaurantAccountService
} from './service-boundary';

describe('RestaurantSignupComponent', () => {
  let accountService: jasmine.SpyObj<RestaurantAccountService>;
  let fixture: ComponentFixture<RestaurantSignupComponent>;
  let component: RestaurantSignupComponent;

  const element = () => fixture.nativeElement as HTMLElement;
  const control = (name: 'restaurantName' | 'email' | 'password') =>
    element().querySelector<HTMLInputElement>(`input[name="${name}"]`)!;

  const enter = (
    name: 'restaurantName' | 'email' | 'password',
    value: string
  ) => {
    const input = control(name);
    input.value = value;
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();
  };

  const submitForm = () => {
    element().querySelector('form')!.dispatchEvent(new Event('submit'));
    fixture.detectChanges();
  };

  beforeEach(async () => {
    accountService = jasmine.createSpyObj<RestaurantAccountService>(
      'RestaurantAccountService',
      ['signup', 'verify', 'checkDashboardAccess']
    );
    accountService.signup.and.returnValue(of({ kind: 'success' }));

    TestBed.configureTestingModule({
      imports: [RestaurantSignupComponent],
      providers: [
        { provide: RESTAURANT_ACCOUNT_SERVICE, useValue: accountService }
      ]
    });

    fixture = TestBed.createComponent(RestaurantSignupComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
    await fixture.whenStable();
  });

  it('renders one unconstrained template-driven form with labeled controls and a masked password', () => {
    const form = element().querySelector<HTMLFormElement>('form')!;
    const labels = Array.from(element().querySelectorAll<HTMLLabelElement>('label'));

    expect(element().querySelectorAll('form').length).toBe(1);
    expect(labels.map((label) => label.textContent?.trim())).toEqual([
      'Restaurant name',
      'Email',
      'Password'
    ]);
    labels.forEach((label) => {
      expect(label.htmlFor).toBeTruthy();
      expect(element().querySelector(`#${label.htmlFor}`)).not.toBeNull();
    });
    expect(control('password').type).toBe('password');
    expect(form.noValidate).toBeTrue();
    expect(
      element().querySelector(
        'input[required], input[minlength], input[maxlength], input[pattern], input[email]'
      )
    ).toBeNull();
    expect(element().querySelectorAll('button[type="submit"]').length).toBe(1);
    expect(element().querySelector('button')?.textContent?.trim()).toBe('Sign up');
  });

  it('submits deliberately unnormalized and invalid values exactly once through the account boundary', () => {
    accountService.signup.and.returnValue(
      of({ kind: 'validation', message: 'Service-owned validation.' })
    );
    enter('restaurantName', '  Mixed   CASE  ');
    enter('email', ' Not-An-Email ');
    enter('password', 'short');

    submitForm();

    expect(accountService.signup).toHaveBeenCalledOnceWith({
      restaurantName: '  Mixed   CASE  ',
      email: ' Not-An-Email ',
      password: 'short'
    });
  });

  it('allows entirely empty values to reach service-owned validation unchanged', () => {
    accountService.signup.and.returnValue(
      of({ kind: 'validation', message: 'Restaurant name is required.' })
    );

    submitForm();

    expect(accountService.signup).toHaveBeenCalledOnceWith({
      restaurantName: '',
      email: '',
      password: ''
    });
  });

  it('shows asynchronous loading and prevents every duplicate submission path', () => {
    const result = new Subject<RestaurantSignupResult>();
    accountService.signup.and.returnValue(result);
    enter('restaurantName', 'Cafe');
    enter('email', 'owner@example.com');
    enter('password', 'password');

    submitForm();
    const button = element().querySelector<HTMLButtonElement>('button')!;

    expect(button.disabled).toBeTrue();
    expect(button.textContent?.trim()).toBe('Signing up…');
    button.click();
    element().querySelector('form')!.dispatchEvent(new Event('submit'));
    component.submit();
    expect(accountService.signup).toHaveBeenCalledTimes(1);

    result.next({ kind: 'success' });
    result.complete();
    fixture.detectChanges();
    expect(element().querySelector('form')).toBeNull();
  });

  it('shows a service validation message, preserves raw name/email, and clears the password', () => {
    const result = new Subject<RestaurantSignupResult>();
    accountService.signup.and.returnValue(result);
    enter('restaurantName', '  Cafe   MiXeD  ');
    enter('email', ' Owner@Example.COM ');
    enter('password', 'secret-value');

    submitForm();
    result.next({ kind: 'validation', message: 'Restaurant name is already in use.' });
    result.complete();
    fixture.detectChanges();

    expect(element().querySelectorAll('[role="alert"]').length).toBe(1);
    expect(element().querySelector('[role="alert"]')?.textContent?.trim()).toBe(
      'Restaurant name is already in use.'
    );
    expect(control('restaurantName').value).toBe('  Cafe   MiXeD  ');
    expect(control('email').value).toBe(' Owner@Example.COM ');
    expect(control('password').value).toBe('');
    expect(element().querySelector('[data-field-error]')).toBeNull();
    expect(element().querySelector<HTMLButtonElement>('button')?.disabled).toBeFalse();
    expect(element().querySelector('button')?.textContent?.trim()).toBe('Sign up');
  });

  [
    ['returned unexpected result', of({ kind: 'unexpected', message: 'Something went wrong. Please try again.' } as const)],
    ['observable error', throwError(() => new Error('sensitive transport detail'))]
  ].forEach(([description, response]) => {
    it(`uses the exact generic fallback and recovers from a ${description}`, () => {
      accountService.signup.and.returnValue(
        response as Observable<RestaurantSignupResult>
      );
      enter('restaurantName', '  Raw   Name  ');
      enter('email', ' Mixed@Email.COM ');
      enter('password', 'secret-value');

      submitForm();

      expect(element().querySelector('[role="alert"]')?.textContent?.trim()).toBe(
        'Something went wrong. Please try again.'
      );
      expect(element().textContent).not.toContain('sensitive transport detail');
      expect(control('restaurantName').value).toBe('  Raw   Name  ');
      expect(control('email').value).toBe(' Mixed@Email.COM ');
      expect(control('password').value).toBe('');
      expect(element().querySelector<HTMLButtonElement>('button')?.disabled).toBeFalse();
      expect(element().querySelector('button')?.textContent?.trim()).toBe('Sign up');
    });
  });

  it('clears the prior error, enters loading, and permits exactly one successful retry', () => {
    const retry = new Subject<RestaurantSignupResult>();
    accountService.signup.and.returnValues(
      of({ kind: 'validation', message: 'Try again.' }),
      retry
    );
    component.restaurantName = 'Cafe';
    component.email = 'owner@example.com';
    component.password = 'first-secret';

    component.submit();
    fixture.detectChanges();
    expect(element().querySelector('[role="alert"]')?.textContent?.trim()).toBe('Try again.');

    component.password = 'second-secret';
    component.submit();
    fixture.detectChanges();
    expect(element().querySelector('[role="alert"]')).toBeNull();
    expect(element().querySelector<HTMLButtonElement>('button')?.disabled).toBeTrue();
    expect(element().querySelector('button')?.textContent?.trim()).toBe('Signing up…');
    component.submit();
    expect(accountService.signup).toHaveBeenCalledTimes(2);

    retry.next({ kind: 'success' });
    retry.complete();
    fixture.detectChanges();
    expect(element().textContent).toContain(
      'Account created. Open the verification link to continue.'
    );
  });
});

describe('signup route', () => {
  it('replaces the signup placeholder, confirms success without forbidden data, and stays on /signup', async () => {
    const accountService = jasmine.createSpyObj<RestaurantAccountService>(
      'RestaurantAccountService',
      ['signup', 'verify', 'checkDashboardAccess']
    );
    accountService.signup.and.returnValue(of({ kind: 'success' }));
    TestBed.configureTestingModule({
      providers: [
        provideRouter(routes),
        { provide: RESTAURANT_ACCOUNT_SERVICE, useValue: accountService }
      ]
    });
    const harness = await RouterTestingHarness.create();
    const routed = (await harness.navigateByUrl(
      '/signup',
      RestaurantSignupComponent
    )) as RestaurantSignupComponent;
    const router = TestBed.inject(Router);
    routed.restaurantName = 'Private Restaurant Name';
    routed.email = 'private@example.com';
    routed.password = 'private-password';

    routed.submit();
    harness.detectChanges();

    const text = harness.routeNativeElement?.textContent ?? '';
    expect(text).toContain('Account created. Open the verification link to continue.');
    expect(router.url).toBe('/signup');
    [
      'Private Restaurant Name',
      'private@example.com',
      'private-password',
      'verification-token',
      '/verify/',
      '/dashboard',
      '/restaurants/',
      'session',
      'account-'
    ].forEach((forbidden) => expect(text).not.toContain(forbidden));
    expect(harness.routeNativeElement?.querySelector('a')).toBeNull();
  });
});
