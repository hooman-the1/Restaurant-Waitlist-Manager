import {
  ActiveEntryActionReference,
  CancelWaitlistEntryInput,
  CancelWaitlistEntryResult,
  DashboardAccessResult,
  DashboardLoadResult,
  DUPLICATE_PHONE_MESSAGE,
  JoinWaitlistInput,
  JoinWaitlistResult,
  PrivateStatusResult,
  PublicWaitlistLookupResult,
  RestaurantSignupInput,
  RestaurantSignupResult,
  StaffResolution,
  StaffResolutionInput,
  StaffResolutionResult,
  UNEXPECTED_ERROR_MESSAGE,
  VerificationInput,
  VerificationResult
} from './api-contracts';

describe('frontend API contracts', () => {
  it('represents restaurant signup outcomes without transport details', () => {
    const input: RestaurantSignupInput = {
      restaurantName: 'Cafe Example',
      email: 'owner@example.com',
      password: 'password'
    };
    const success: RestaurantSignupResult = { kind: 'success' };
    const validationFailure: RestaurantSignupResult = {
      kind: 'validation',
      message: 'Restaurant name is already in use.'
    };

    expect(input.restaurantName).toBe('Cafe Example');
    expect(success.kind).toBe('success');
    expect(validationFailure.kind).toBe('validation');

    // @ts-expect-error Signup success must not expose a database ID.
    success.databaseId;
    // @ts-expect-error Signup success must not expose a public waitlist URL.
    success.publicWaitlistUrl;
  });

  it('represents verification and dashboard-access outcomes', () => {
    const verificationInput: VerificationInput = { token: 'verification-token' };
    const invalidVerification: VerificationResult = { kind: 'invalid-or-used-token' };
    const allowed: DashboardAccessResult = { kind: 'allowed' };
    const unauthorized: DashboardAccessResult = { kind: 'unauthorized' };

    expect(verificationInput.token).toBe('verification-token');
    expect(invalidVerification.kind).toBe('invalid-or-used-token');
    expect(allowed.kind).toBe('allowed');
    expect(unauthorized.kind).toBe('unauthorized');
  });

  it('represents the exact dashboard display model', () => {
    const actionReference = 'active-entry-reference' as ActiveEntryActionReference;
    const result: DashboardLoadResult = {
      kind: 'success',
      dashboard: {
        restaurantName: 'Cafe Example',
        activeEntries: [
          {
            position: 1,
            customerName: 'A Customer',
            phone: '(555) 123-4567',
            partySize: 2,
            actionReference
          }
        ],
        resolvedToday: [
          {
            customerName: 'B Customer',
            partySize: 4,
            finalStatus: 'seated'
          }
        ]
      }
    };

    if (result.kind !== 'success') {
      fail('Expected a populated dashboard');
    }

    expect(result.dashboard.activeEntries[0].position).toBe(1);
    expect(result.dashboard.resolvedToday[0].finalStatus).toBe('seated');
    // @ts-expect-error Resolved dashboard entries never expose phone numbers.
    result.dashboard.resolvedToday[0].phone;
    // @ts-expect-error Resolved dashboard entries never expose former positions.
    result.dashboard.resolvedToday[0].position;
  });

  it('represents public lookup and queue joining outcomes', () => {
    const missingRestaurant: PublicWaitlistLookupResult = { kind: 'not-found' };
    const joinInput: JoinWaitlistInput = {
      customerName: 'A Customer',
      phone: '555-123-4567',
      partySize: 3
    };
    const duplicatePhone: JoinWaitlistResult = {
      kind: 'duplicate-phone',
      message: DUPLICATE_PHONE_MESSAGE
    };

    expect(missingRestaurant.kind).toBe('not-found');
    expect(joinInput.partySize).toBe(3);
    expect(duplicatePhone.message).toBe(
      'This phone number is already on the waitlist.'
    );
  });

  it('narrows active, resolved, and unavailable private status', () => {
    const results: PrivateStatusResult[] = [
      { kind: 'active', restaurantName: 'Cafe Example', position: 2 },
      { kind: 'resolved', restaurantName: 'Cafe Example', finalStatus: 'no-show' },
      { kind: 'not-found' }
    ];

    expect(results.map((result) => result.kind)).toEqual([
      'active',
      'resolved',
      'not-found'
    ]);

    const active = results[0];
    if (active.kind !== 'active') {
      fail('Expected an active private status');
    }
    // @ts-expect-error Private status never exposes the customer phone.
    active.phone;
    // @ts-expect-error Private status never exposes an internal database ID.
    active.databaseId;
  });

  it('represents cancellation and every allowed staff resolution', () => {
    const cancellationInput: CancelWaitlistEntryInput = { privateToken: 'private-token' };
    const cancellation: CancelWaitlistEntryResult = { kind: 'cancelled' };
    const resolutions: StaffResolution[] = ['seated', 'cancelled', 'no-show'];
    const actionReference = 'active-entry-reference' as ActiveEntryActionReference;
    const resolutionInput: StaffResolutionInput = {
      actionReference,
      resolution: 'cancelled'
    };
    const resolutionResult: StaffResolutionResult = { kind: 'success' };

    expect(cancellationInput.privateToken).toBe('private-token');
    expect(cancellation.kind).toBe('cancelled');
    expect(resolutions).toEqual(['seated', 'cancelled', 'no-show']);
    expect(resolutionInput.resolution).toBe('cancelled');
    expect(resolutionResult.kind).toBe('success');

    const invalidResolution: StaffResolutionInput = {
      actionReference,
      // @ts-expect-error Staff cannot choose a resolution outside the frozen set.
      resolution: 'waiting'
    };
    expect(invalidResolution.resolution).toBe('waiting');
  });

  it('supplies the frozen fallback text for unexpected failures', () => {
    const unexpected: RestaurantSignupResult = {
      kind: 'unexpected',
      message: UNEXPECTED_ERROR_MESSAGE
    };

    expect(unexpected.message).toBe('Something went wrong. Please try again.');
    // @ts-expect-error Application failures never expose HTTP status codes.
    unexpected.statusCode;
  });
});
