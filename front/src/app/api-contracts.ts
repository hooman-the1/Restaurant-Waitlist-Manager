/**
 * Application-owned contracts shared by frontend consumers and service implementations.
 * These types deliberately contain no HTTP, persistence, cookie, or backend DTO details.
 */

export const UNEXPECTED_ERROR_MESSAGE = 'Something went wrong. Please try again.' as const;
export const DUPLICATE_PHONE_MESSAGE =
  'This phone number is already on the waitlist.' as const;

export interface ValidationFailure {
  readonly kind: 'validation';
  readonly message: string;
}

export interface UnauthorizedFailure {
  readonly kind: 'unauthorized';
}

export interface NotFoundFailure {
  readonly kind: 'not-found';
}

export interface UnexpectedFailure {
  readonly kind: 'unexpected';
  readonly message: typeof UNEXPECTED_ERROR_MESSAGE;
}

export interface Success {
  readonly kind: 'success';
}

export interface RestaurantSignupInput {
  readonly restaurantName: string;
  readonly email: string;
  readonly password: string;
}

export type RestaurantSignupResult = Success | ValidationFailure | UnexpectedFailure;

export interface VerificationInput {
  readonly token: string;
}

export interface InvalidOrUsedVerificationTokenFailure {
  readonly kind: 'invalid-or-used-token';
}

export type VerificationResult =
  | Success
  | InvalidOrUsedVerificationTokenFailure
  | UnexpectedFailure;

export interface DashboardAccessAllowed {
  readonly kind: 'allowed';
}

export type DashboardAccessResult =
  | DashboardAccessAllowed
  | UnauthorizedFailure
  | UnexpectedFailure;

export type FinalStatus = 'seated' | 'cancelled' | 'no-show';
export type StaffResolution = FinalStatus;

declare const activeEntryActionReferenceBrand: unique symbol;

/**
 * An opaque, application-owned reference for a staff action. It is not a database ID,
 * customer private-status token, or URL and must not be presented to customers.
 */
export type ActiveEntryActionReference = string & {
  readonly [activeEntryActionReferenceBrand]: 'ActiveEntryActionReference';
};

export interface ActiveDashboardEntry {
  readonly position: number;
  readonly customerName: string;
  readonly phone: string;
  readonly partySize: number;
  readonly actionReference: ActiveEntryActionReference;
}

export interface ResolvedDashboardEntry {
  readonly customerName: string;
  readonly partySize: number;
  readonly finalStatus: FinalStatus;
}

export interface DashboardView {
  readonly restaurantName: string;
  readonly activeEntries: readonly ActiveDashboardEntry[];
  readonly resolvedToday: readonly ResolvedDashboardEntry[];
}

export interface DashboardLoadSuccess {
  readonly kind: 'success';
  readonly dashboard: DashboardView;
}

export type DashboardLoadResult =
  | DashboardLoadSuccess
  | UnauthorizedFailure
  | UnexpectedFailure;

export interface PublicWaitlistLookupInput {
  readonly restaurantSlug: string;
}

export interface PublicRestaurantView {
  readonly restaurantName: string;
}

export interface PublicWaitlistLookupSuccess {
  readonly kind: 'success';
  readonly restaurant: PublicRestaurantView;
}

export type PublicWaitlistLookupResult =
  | PublicWaitlistLookupSuccess
  | NotFoundFailure
  | UnexpectedFailure;

export interface JoinWaitlistInput {
  readonly customerName: string;
  readonly phone: string;
  readonly partySize: number;
}

export interface JoinWaitlistSuccess {
  readonly kind: 'success';
  readonly privateStatusToken: string;
}

export interface DuplicatePhoneFailure {
  readonly kind: 'duplicate-phone';
  readonly message: typeof DUPLICATE_PHONE_MESSAGE;
}

export type JoinWaitlistResult =
  | JoinWaitlistSuccess
  | NotFoundFailure
  | ValidationFailure
  | DuplicatePhoneFailure
  | UnexpectedFailure;

export interface PrivateStatusLookupInput {
  readonly privateToken: string;
}

export interface ActivePrivateStatusView {
  readonly kind: 'active';
  readonly restaurantName: string;
  readonly position: number;
}

export interface ResolvedPrivateStatusView {
  readonly kind: 'resolved';
  readonly restaurantName: string;
  readonly finalStatus: FinalStatus;
}

export type PrivateStatusResult =
  | ActivePrivateStatusView
  | ResolvedPrivateStatusView
  | NotFoundFailure
  | UnexpectedFailure;

export interface CancelWaitlistEntryInput {
  readonly privateToken: string;
}

export interface CancellationSuccess {
  readonly kind: 'cancelled';
}

export type CancelWaitlistEntryResult =
  | CancellationSuccess
  | NotFoundFailure
  | UnexpectedFailure;

export interface StaffResolutionInput {
  readonly actionReference: ActiveEntryActionReference;
  readonly resolution: StaffResolution;
}

export type StaffResolutionResult =
  | Success
  | UnauthorizedFailure
  | NotFoundFailure
  | UnexpectedFailure;
