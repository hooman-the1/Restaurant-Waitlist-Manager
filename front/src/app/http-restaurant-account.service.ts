import { HttpClient } from '@angular/common/http';
import { Inject, Injectable } from '@angular/core';
import { catchError, defer, map, Observable, of } from 'rxjs';

import {
  DashboardAccessResult,
  RestaurantSignupInput,
  RestaurantSignupResult,
  VerificationInput,
  VerificationResult
} from './api-contracts';
import { API_BASE_URL, apiUrl } from './api-base-url';
import {
  isDashboardAccessAllowed,
  isInvalidVerificationFailure,
  isSuccess,
  isUnauthorizedFailure,
  isUnexpectedFailure,
  isValidationFailure,
  mapFailure,
  mapSuccess
} from './http-result-mapping';
import { RestaurantAccountService } from './service-boundary';

@Injectable()
export class HttpRestaurantAccountService implements RestaurantAccountService {
  constructor(
    private readonly http: HttpClient,
    @Inject(API_BASE_URL) private readonly baseUrl: string
  ) {}

  signup(input: RestaurantSignupInput): Observable<RestaurantSignupResult> {
    return defer(() =>
      this.http.post<unknown>(apiUrl(this.baseUrl, '/api/restaurants'), {
        restaurantName: input.restaurantName,
        email: input.email,
        password: input.password
      }, {
        observe: 'response',
        withCredentials: true
      })
    ).pipe(
      map((response) => mapSuccess(response, 201, isSuccess)),
      catchError((error: unknown) =>
        of(mapFailure<RestaurantSignupResult>(error, [
          { status: 400, guard: isValidationFailure },
          { status: 409, guard: isValidationFailure },
          { status: 500, guard: isUnexpectedFailure }
        ]))
      )
    );
  }

  verify(input: VerificationInput): Observable<VerificationResult> {
    return defer(() =>
      this.http.post<unknown>(apiUrl(this.baseUrl, '/api/restaurant-verifications'), {
        token: input.token
      }, {
        observe: 'response',
        withCredentials: true
      })
    ).pipe(
      map((response) => mapSuccess(response, 200, isSuccess)),
      catchError((error: unknown) =>
        of(mapFailure<VerificationResult>(error, [
          { status: 400, guard: isInvalidVerificationFailure },
          { status: 500, guard: isUnexpectedFailure }
        ]))
      )
    );
  }

  checkDashboardAccess(): Observable<DashboardAccessResult> {
    return defer(() =>
      this.http.get<unknown>(apiUrl(this.baseUrl, '/api/restaurant-session'), {
        observe: 'response',
        withCredentials: true
      })
    ).pipe(
      map((response) => mapSuccess(response, 200, isDashboardAccessAllowed)),
      catchError((error: unknown) =>
        of(mapFailure<DashboardAccessResult>(error, [
          { status: 401, guard: isUnauthorizedFailure },
          { status: 500, guard: isUnexpectedFailure }
        ]))
      )
    );
  }
}
