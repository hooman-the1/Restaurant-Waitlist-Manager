import { HttpErrorResponse, HttpResponse } from '@angular/common/http';

import {
  ActiveDashboardEntry,
  CancellationSuccess,
  DashboardAccessAllowed,
  DashboardLoadSuccess,
  DuplicatePhoneFailure,
  DUPLICATE_PHONE_MESSAGE,
  FinalStatus,
  InvalidOrUsedVerificationTokenFailure,
  JoinWaitlistSuccess,
  NotFoundFailure,
  PrivateStatusResult,
  PublicWaitlistLookupSuccess,
  ResolvedDashboardEntry,
  Success,
  UnauthorizedFailure,
  UnexpectedFailure,
  UNEXPECTED_ERROR_MESSAGE,
  ValidationFailure
} from './api-contracts';

type JsonObject = Record<string, unknown>;
type Guard<T> = (value: unknown) => value is T;

export interface FailureMapping {
  readonly status: number;
  readonly guard: (value: unknown) => boolean;
}

export function mapSuccess<T>(
  response: HttpResponse<unknown>,
  status: number,
  guard: Guard<T>
): T | UnexpectedFailure {
  return response.status === status && guard(response.body)
    ? response.body
    : unexpectedResult();
}

export function mapFailure<T>(
  error: unknown,
  mappings: readonly FailureMapping[]
): T | UnexpectedFailure {
  if (error instanceof HttpErrorResponse) {
    const mapping = mappings.find(({ status }) => status === error.status);
    if (mapping?.guard(error.error)) {
      return error.error as T;
    }
  }
  return unexpectedResult();
}

export function unexpectedResult(): UnexpectedFailure {
  return { kind: 'unexpected', message: UNEXPECTED_ERROR_MESSAGE };
}

export const isSuccess: Guard<Success> = (value): value is Success =>
  hasExactKeys(value, ['kind']) && value['kind'] === 'success';

export const isDashboardAccessAllowed: Guard<DashboardAccessAllowed> = (
  value
): value is DashboardAccessAllowed =>
  hasExactKeys(value, ['kind']) && value['kind'] === 'allowed';

export const isValidationFailure: Guard<ValidationFailure> = (
  value
): value is ValidationFailure =>
  hasExactKeys(value, ['kind', 'message']) &&
  value['kind'] === 'validation' &&
  typeof value['message'] === 'string';

export const isUnauthorizedFailure: Guard<UnauthorizedFailure> = (
  value
): value is UnauthorizedFailure =>
  hasExactKeys(value, ['kind']) && value['kind'] === 'unauthorized';

export const isNotFoundFailure: Guard<NotFoundFailure> = (
  value
): value is NotFoundFailure =>
  hasExactKeys(value, ['kind']) && value['kind'] === 'not-found';

export const isInvalidVerificationFailure: Guard<InvalidOrUsedVerificationTokenFailure> = (
  value
): value is InvalidOrUsedVerificationTokenFailure =>
  hasExactKeys(value, ['kind']) && value['kind'] === 'invalid-or-used-token';

export const isUnexpectedFailure: Guard<UnexpectedFailure> = (
  value
): value is UnexpectedFailure =>
  hasExactKeys(value, ['kind', 'message']) &&
  value['kind'] === 'unexpected' &&
  value['message'] === UNEXPECTED_ERROR_MESSAGE;

export const isDuplicatePhoneFailure: Guard<DuplicatePhoneFailure> = (
  value
): value is DuplicatePhoneFailure =>
  hasExactKeys(value, ['kind', 'message']) &&
  value['kind'] === 'duplicate-phone' &&
  value['message'] === DUPLICATE_PHONE_MESSAGE;

export const isPublicLookupSuccess: Guard<PublicWaitlistLookupSuccess> = (
  value
): value is PublicWaitlistLookupSuccess =>
  hasExactKeys(value, ['kind', 'restaurant']) &&
  value['kind'] === 'success' &&
  hasExactKeys(value['restaurant'], ['restaurantName']) &&
  typeof value['restaurant']['restaurantName'] === 'string';

export const isJoinSuccess: Guard<JoinWaitlistSuccess> = (
  value
): value is JoinWaitlistSuccess =>
  hasExactKeys(value, ['kind', 'privateStatusToken']) &&
  value['kind'] === 'success' &&
  isNonEmptyString(value['privateStatusToken']);

export const isCancellationSuccess: Guard<CancellationSuccess> = (
  value
): value is CancellationSuccess =>
  hasExactKeys(value, ['kind']) && value['kind'] === 'cancelled';

export const isPrivateStatus: Guard<PrivateStatusResult> = (
  value
): value is PrivateStatusResult => {
  if (!isObject(value)) {
    return false;
  }
  if (value['kind'] === 'active') {
    return (
      hasExactKeys(value, ['kind', 'restaurantName', 'position']) &&
      typeof value['restaurantName'] === 'string' &&
      isIntegerAtLeast(value['position'], 1)
    );
  }
  if (value['kind'] === 'resolved') {
    return (
      hasExactKeys(value, ['kind', 'restaurantName', 'finalStatus']) &&
      typeof value['restaurantName'] === 'string' &&
      isFinalStatus(value['finalStatus'])
    );
  }
  return false;
};

export const isDashboardLoadSuccess: Guard<DashboardLoadSuccess> = (
  value
): value is DashboardLoadSuccess =>
  hasExactKeys(value, ['kind', 'dashboard']) &&
  value['kind'] === 'success' &&
  hasExactKeys(value['dashboard'], [
    'restaurantName',
    'activeEntries',
    'resolvedToday'
  ]) &&
  typeof value['dashboard']['restaurantName'] === 'string' &&
  Array.isArray(value['dashboard']['activeEntries']) &&
  value['dashboard']['activeEntries'].every(isActiveDashboardEntry) &&
  Array.isArray(value['dashboard']['resolvedToday']) &&
  value['dashboard']['resolvedToday'].every(isResolvedDashboardEntry);

function isActiveDashboardEntry(value: unknown): value is ActiveDashboardEntry {
  return (
    hasExactKeys(value, [
      'position',
      'customerName',
      'phone',
      'partySize',
      'actionReference'
    ]) &&
    isIntegerAtLeast(value['position'], 1) &&
    typeof value['customerName'] === 'string' &&
    typeof value['phone'] === 'string' &&
    isIntegerBetween(value['partySize'], 1, 30) &&
    isNonEmptyString(value['actionReference'])
  );
}

function isResolvedDashboardEntry(
  value: unknown
): value is ResolvedDashboardEntry {
  return (
    hasExactKeys(value, ['customerName', 'partySize', 'finalStatus']) &&
    typeof value['customerName'] === 'string' &&
    isIntegerBetween(value['partySize'], 1, 30) &&
    isFinalStatus(value['finalStatus'])
  );
}

function hasExactKeys(
  value: unknown,
  expectedKeys: readonly string[]
): value is JsonObject {
  if (!isObject(value)) {
    return false;
  }
  const actualKeys = Object.keys(value).sort();
  const sortedExpected = [...expectedKeys].sort();
  return (
    actualKeys.length === sortedExpected.length &&
    actualKeys.every((key, index) => key === sortedExpected[index])
  );
}

function isObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function isIntegerAtLeast(value: unknown, minimum: number): value is number {
  return Number.isInteger(value) && (value as number) >= minimum;
}

function isIntegerBetween(
  value: unknown,
  minimum: number,
  maximum: number
): value is number {
  return (
    Number.isInteger(value) &&
    (value as number) >= minimum &&
    (value as number) <= maximum
  );
}

function isFinalStatus(value: unknown): value is FinalStatus {
  return value === 'seated' || value === 'cancelled' || value === 'no-show';
}
