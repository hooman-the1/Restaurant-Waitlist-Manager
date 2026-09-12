import { fakeAsync, flushMicrotasks, TestBed, tick } from '@angular/core/testing';
import { firstValueFrom } from 'rxjs';

import { UNEXPECTED_ERROR_MESSAGE } from './api-contracts';
import {
  MockRestaurantAccountService,
  MockRestaurantAccountTestOptions
} from './mock-restaurant-account.service';
import { RESTAURANT_ACCOUNT_SERVICE } from './service-boundary';

describe('MockRestaurantAccountService', () => {
  const signup = (
    service: MockRestaurantAccountService,
    restaurantName = 'The Garden',
    email = 'owner@example.com',
    password = '12345678'
  ) => service.signup({ restaurantName, email, password });

  const isolatedService = (options: MockRestaurantAccountTestOptions = {}) =>
    MockRestaurantAccountService.createForTesting({
      initialSession: 'none',
      verificationTokenFactory: () => 'known-verification-token',
      ...options
    });

  it('registers the concrete mock behind the application-owned token', () => {
    const concrete = isolatedService();
    TestBed.configureTestingModule({
      providers: [{ provide: RESTAURANT_ACCOUNT_SERVICE, useValue: concrete }]
    });

    const service = TestBed.inject(RESTAURANT_ACCOUNT_SERVICE);

    expect(service).toBe(concrete);
  });

  it('emits one result asynchronously and completes for every operation', fakeAsync(() => {
    const service = isolatedService();
    const events: string[] = [];

    service.signup({ restaurantName: 'Cafe', email: 'cafe@example.com', password: '12345678' })
      .subscribe({ next: () => events.push('signup-next'), complete: () => events.push('signup-complete') });
    expect(events).toEqual([]);
    flushMicrotasks();
    expect(events).toEqual(['signup-next', 'signup-complete']);

    events.length = 0;
    service.verify({ token: 'known-verification-token' }).subscribe({
      next: () => events.push('verify-next'),
      complete: () => events.push('verify-complete')
    });
    expect(events).toEqual([]);
    flushMicrotasks();
    expect(events).toEqual(['verify-next', 'verify-complete']);

    events.length = 0;
    service.checkDashboardAccess().subscribe({
      next: () => events.push('access-next'),
      complete: () => events.push('access-complete')
    });
    expect(events).toEqual([]);
    flushMicrotasks();
    expect(events).toEqual(['access-next', 'access-complete']);
  }));

  it('stores the canonical display name and compares names case-insensitively', async () => {
    const service = isolatedService();

    expect(await firstValueFrom(signup(service, '  The   Garden  '))).toEqual({ kind: 'success' });
    expect(await firstValueFrom(signup(service, ' the garden ', 'second@example.com'))).toEqual(
      jasmine.objectContaining({ kind: 'validation' })
    );
    expect(await firstValueFrom(signup(service, 'THE   GARDEN', 'third@example.com'))).toEqual(
      jasmine.objectContaining({ kind: 'validation' })
    );
  });

  it('rejects an empty normalized name', async () => {
    expect(await firstValueFrom(signup(isolatedService(), ' \t  '))).toEqual(
      jasmine.objectContaining({ kind: 'validation' })
    );
  });

  it('compares trimmed case-folded emails without provider-specific aliasing', async () => {
    const service = isolatedService({
      verificationTokenFactory: jasmine.createSpy().and.returnValues('token-1', 'token-2', 'token-3')
    });

    expect(await firstValueFrom(signup(service, 'First', ' Owner@Example.com '))).toEqual({ kind: 'success' });
    expect(await firstValueFrom(signup(service, 'Second', 'owner@example.COM'))).toEqual(
      jasmine.objectContaining({ kind: 'validation' })
    );
    expect(await firstValueFrom(signup(service, 'Third', 'owner+tag@example.com'))).toEqual({ kind: 'success' });
    expect(await firstValueFrom(signup(service, 'Fourth', 'ow.ner@example.com'))).toEqual({ kind: 'success' });
  });

  [
    ['', 'empty'],
    ['owner.example.com', 'missing @'],
    ['@example.com', 'missing local part'],
    ['owner@', 'missing domain'],
    ['owner@example', 'domain without dot'],
    ['own er@example.com', 'embedded whitespace']
  ].forEach(([email, description]) => {
    it(`rejects a basic-invalid email: ${description}`, async () => {
      expect(await firstValueFrom(signup(isolatedService(), 'Cafe', email))).toEqual(
        jasmine.objectContaining({ kind: 'validation' })
      );
    });
  });

  it('accepts a conventional email', async () => {
    expect(await firstValueFrom(signup(isolatedService(), 'Cafe', 'owner@example.com'))).toEqual({
      kind: 'success'
    });
  });

  it('enforces only the eight-character password boundary', async () => {
    const service = isolatedService({
      verificationTokenFactory: jasmine.createSpy().and.returnValues('token-1', 'token-2')
    });

    expect(await firstValueFrom(signup(service, 'Short', 'short@example.com', '1234567'))).toEqual(
      jasmine.objectContaining({ kind: 'validation' })
    );
    expect(await firstValueFrom(signup(service, 'Exact', 'exact@example.com', '        '))).toEqual({
      kind: 'success'
    });
  });

  it('does not mutate accounts, tokens, or a valid session on signup failure', async () => {
    const tokenFactory = jasmine.createSpy().and.returnValue('original-token');
    const service = isolatedService({ verificationTokenFactory: tokenFactory });

    expect(await firstValueFrom(signup(service))).toEqual({ kind: 'success' });
    expect(await firstValueFrom(signup(service, 'THE GARDEN', 'other@example.com'))).toEqual(
      jasmine.objectContaining({ kind: 'validation' })
    );
    expect(tokenFactory).toHaveBeenCalledTimes(1);
    expect(await firstValueFrom(service.verify({ token: 'original-token' }))).toEqual({ kind: 'success' });
    expect(await firstValueFrom(service.checkDashboardAccess())).toEqual({ kind: 'allowed' });
  });

  it('keeps an unused opaque verification token valid without time expiry', fakeAsync(() => {
    const service = isolatedService({ verificationTokenFactory: () => 'opaque-token-value' });
    let verificationKind: string | undefined;

    signup(service).subscribe();
    flushMicrotasks();
    tick(365 * 24 * 60 * 60 * 1000);
    service.verify({ token: 'opaque-token-value' }).subscribe((result) => (verificationKind = result.kind));
    flushMicrotasks();

    expect(verificationKind).toBe('success');
  }));

  it('consumes a known token, verifies its account, and establishes the session', async () => {
    const service = isolatedService();

    expect(await firstValueFrom(signup(service))).toEqual({ kind: 'success' });
    expect(await firstValueFrom(service.checkDashboardAccess())).toEqual({ kind: 'unauthorized' });
    expect(await firstValueFrom(service.verify({ token: 'known-verification-token' }))).toEqual({ kind: 'success' });
    expect(await firstValueFrom(service.checkDashboardAccess())).toEqual({ kind: 'allowed' });
    expect(await firstValueFrom(service.verify({ token: 'known-verification-token' }))).toEqual({
      kind: 'invalid-or-used-token'
    });
  });

  it('rejects empty and unknown tokens without disturbing tokens or a valid session', async () => {
    const service = isolatedService();
    await firstValueFrom(signup(service));

    expect(await firstValueFrom(service.verify({ token: '' }))).toEqual({ kind: 'invalid-or-used-token' });
    expect(await firstValueFrom(service.verify({ token: 'unknown' }))).toEqual({ kind: 'invalid-or-used-token' });
    expect(await firstValueFrom(service.verify({ token: 'known-verification-token' }))).toEqual({ kind: 'success' });
    expect(await firstValueFrom(service.verify({ token: 'another-unknown' }))).toEqual({ kind: 'invalid-or-used-token' });
    expect(await firstValueFrom(service.checkDashboardAccess())).toEqual({ kind: 'allowed' });
  });

  it('defaults to exactly the verified demo account and authorized session needed by later work', async () => {
    const service = MockRestaurantAccountService.createDefault();

    expect(await firstValueFrom(service.checkDashboardAccess())).toEqual({ kind: 'allowed' });
    expect(await firstValueFrom(service.verify({ token: 'demo-token' }))).toEqual({
      kind: 'invalid-or-used-token'
    });
  });

  ['none', 'unverified', 'missing'].forEach((initialSession) => {
    it(`denies dashboard access for a ${initialSession} session`, async () => {
      const service = MockRestaurantAccountService.createForTesting({
        initialSession: initialSession as MockRestaurantAccountTestOptions['initialSession']
      });

      expect(await firstValueFrom(service.checkDashboardAccess())).toEqual({ kind: 'unauthorized' });
    });
  });

  it('converts a pre-commit operational fault to the application-owned unexpected result', async () => {
    const service = isolatedService({
      verificationTokenFactory: () => {
        throw new Error('sensitive internal detail');
      }
    });

    expect(await firstValueFrom(signup(service))).toEqual({
      kind: 'unexpected',
      message: UNEXPECTED_ERROR_MESSAGE
    });
    expect(await firstValueFrom(service.checkDashboardAccess())).toEqual({ kind: 'unauthorized' });
    expect(await firstValueFrom(service.verify({ token: 'known-verification-token' }))).toEqual({
      kind: 'invalid-or-used-token'
    });
  });
});
