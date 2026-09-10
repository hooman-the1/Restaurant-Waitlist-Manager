import { asapScheduler, catchError, defer, Observable, observeOn, of } from 'rxjs';

import {
  DashboardAccessResult,
  RestaurantSignupInput,
  RestaurantSignupResult,
  UNEXPECTED_ERROR_MESSAGE,
  VerificationInput,
  VerificationResult
} from './api-contracts';
import { RestaurantAccountService } from './service-boundary';

interface MockRestaurantAccount {
  readonly id: string;
  readonly displayName: string;
  readonly comparisonName: string;
  readonly comparisonEmail: string;
  readonly verified: boolean;
}

export interface MockRestaurantAccountTestOptions {
  readonly initialSession?: 'none' | 'unverified' | 'missing';
  readonly verificationTokenFactory?: () => string;
}

export class MockRestaurantAccountService implements RestaurantAccountService {
  private readonly accounts = new Map<string, MockRestaurantAccount>();
  private readonly verificationTokens = new Map<string, string>();
  private currentSessionAccountId: string | undefined;
  private nextAccountNumber = 1;

  private constructor(private readonly verificationTokenFactory: () => string) {}

  static createDefault(): MockRestaurantAccountService {
    const service = new MockRestaurantAccountService(() =>
      `verification-${crypto.randomUUID()}`
    );
    const account: MockRestaurantAccount = {
      id: 'account-1',
      displayName: 'Demo Restaurant',
      comparisonName: 'demo restaurant',
      comparisonEmail: 'demo@example.com',
      verified: true
    };
    service.accounts.set(account.id, account);
    service.currentSessionAccountId = account.id;
    service.nextAccountNumber = 2;
    return service;
  }

  static createForTesting(
    options: MockRestaurantAccountTestOptions = {}
  ): MockRestaurantAccountService {
    const service = new MockRestaurantAccountService(
      options.verificationTokenFactory ?? (() => `verification-${crypto.randomUUID()}`)
    );

    if (options.initialSession === 'unverified') {
      const account: MockRestaurantAccount = {
        id: 'account-1',
        displayName: 'Unverified Restaurant',
        comparisonName: 'unverified restaurant',
        comparisonEmail: 'unverified@example.com',
        verified: false
      };
      service.accounts.set(account.id, account);
      service.currentSessionAccountId = account.id;
      service.nextAccountNumber = 2;
    } else if (options.initialSession === 'missing') {
      service.currentSessionAccountId = 'missing-account';
    }

    return service;
  }

  signup(input: RestaurantSignupInput): Observable<RestaurantSignupResult> {
    return this.oneAsyncResult(() => this.signupResult(input));
  }

  verify(input: VerificationInput): Observable<VerificationResult> {
    return this.oneAsyncResult(() => this.verificationResult(input));
  }

  checkDashboardAccess(): Observable<DashboardAccessResult> {
    return this.oneAsyncResult(() => {
      const account = this.currentSessionAccountId
        ? this.accounts.get(this.currentSessionAccountId)
        : undefined;
      return account?.verified ? { kind: 'allowed' } : { kind: 'unauthorized' };
    });
  }

  private signupResult(input: RestaurantSignupInput): RestaurantSignupResult {
    const displayName = input.restaurantName.trim().replace(/\s+/g, ' ');
    const comparisonName = displayName.toLowerCase();
    const comparisonEmail = input.email.trim().toLowerCase();

    if (!displayName) {
      return { kind: 'validation', message: 'Restaurant name is required.' };
    }
    if (!this.isBasicEmail(comparisonEmail)) {
      return { kind: 'validation', message: 'Enter a valid email address.' };
    }
    if (input.password.length < 8) {
      return { kind: 'validation', message: 'Password must be at least 8 characters.' };
    }
    if ([...this.accounts.values()].some((account) => account.comparisonName === comparisonName)) {
      return { kind: 'validation', message: 'Restaurant name is already in use.' };
    }
    if ([...this.accounts.values()].some((account) => account.comparisonEmail === comparisonEmail)) {
      return { kind: 'validation', message: 'Email is already in use.' };
    }

    const accountId = `account-${this.nextAccountNumber}`;
    const verificationToken = this.verificationTokenFactory();
    if (
      !verificationToken ||
      verificationToken === accountId ||
      this.verificationTokens.has(verificationToken)
    ) {
      throw new Error('Verification token generation failed.');
    }

    this.accounts.set(accountId, {
      id: accountId,
      displayName,
      comparisonName,
      comparisonEmail,
      verified: false
    });
    this.verificationTokens.set(verificationToken, accountId);
    this.nextAccountNumber += 1;
    return { kind: 'success' };
  }

  private verificationResult(input: VerificationInput): VerificationResult {
    if (!input.token) {
      return { kind: 'invalid-or-used-token' };
    }

    const accountId = this.verificationTokens.get(input.token);
    const account = accountId ? this.accounts.get(accountId) : undefined;
    if (!accountId || !account) {
      return { kind: 'invalid-or-used-token' };
    }

    this.accounts.set(accountId, { ...account, verified: true });
    this.verificationTokens.delete(input.token);
    this.currentSessionAccountId = accountId;
    return { kind: 'success' };
  }

  private oneAsyncResult<Result>(operation: () => Result): Observable<Result> {
    return defer(() => of(operation())).pipe(
      observeOn(asapScheduler),
      catchError(() =>
        of({ kind: 'unexpected', message: UNEXPECTED_ERROR_MESSAGE } as Result).pipe(
          observeOn(asapScheduler)
        )
      )
    );
  }

  private isBasicEmail(email: string): boolean {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
  }

}
