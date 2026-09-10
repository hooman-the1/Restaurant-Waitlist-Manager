import { InjectionToken } from '@angular/core';
import { Observable } from 'rxjs';

import {
  CancelWaitlistEntryInput,
  CancelWaitlistEntryResult,
  DashboardAccessResult,
  DashboardLoadResult,
  JoinWaitlistInput,
  JoinWaitlistResult,
  PrivateStatusLookupInput,
  PrivateStatusResult,
  PublicWaitlistLookupInput,
  PublicWaitlistLookupResult,
  RestaurantSignupInput,
  RestaurantSignupResult,
  StaffResolutionInput,
  StaffResolutionResult,
  VerificationInput,
  VerificationResult
} from './api-contracts';

export interface RestaurantAccountService {
  signup(input: RestaurantSignupInput): Observable<RestaurantSignupResult>;
  verify(input: VerificationInput): Observable<VerificationResult>;
  checkDashboardAccess(): Observable<DashboardAccessResult>;
}

export interface RestaurantDashboardService {
  loadDashboard(): Observable<DashboardLoadResult>;
  resolveEntry(input: StaffResolutionInput): Observable<StaffResolutionResult>;
}

export interface CustomerWaitlistService {
  lookupPublicRestaurant(
    input: PublicWaitlistLookupInput
  ): Observable<PublicWaitlistLookupResult>;
  joinWaitlist(input: JoinWaitlistInput): Observable<JoinWaitlistResult>;
  loadPrivateStatus(input: PrivateStatusLookupInput): Observable<PrivateStatusResult>;
  cancelEntry(input: CancelWaitlistEntryInput): Observable<CancelWaitlistEntryResult>;
}

export const RESTAURANT_ACCOUNT_SERVICE =
  new InjectionToken<RestaurantAccountService>('RestaurantAccountService');

export const RESTAURANT_DASHBOARD_SERVICE =
  new InjectionToken<RestaurantDashboardService>('RestaurantDashboardService');

export const CUSTOMER_WAITLIST_SERVICE =
  new InjectionToken<CustomerWaitlistService>('CustomerWaitlistService');
