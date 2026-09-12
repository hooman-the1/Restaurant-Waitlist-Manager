import { HttpClient } from '@angular/common/http';
import { Inject, Injectable } from '@angular/core';
import { catchError, defer, map, Observable, of } from 'rxjs';

import {
  CancelWaitlistEntryInput,
  CancelWaitlistEntryResult,
  JoinWaitlistInput,
  JoinWaitlistResult,
  PrivateStatusLookupInput,
  PrivateStatusResult,
  PublicWaitlistLookupInput,
  PublicWaitlistLookupResult
} from './api-contracts';
import { API_BASE_URL, apiUrl, encodePathSegment } from './api-base-url';
import {
  isCancellationSuccess,
  isDuplicatePhoneFailure,
  isJoinSuccess,
  isNotFoundFailure,
  isPrivateStatus,
  isPublicLookupSuccess,
  isUnexpectedFailure,
  isValidationFailure,
  mapFailure,
  mapSuccess
} from './http-result-mapping';
import { CustomerWaitlistService } from './service-boundary';

@Injectable()
export class HttpCustomerWaitlistService implements CustomerWaitlistService {
  private selectedRestaurantSlug: string | undefined;
  private lookupSequence = 0;

  constructor(
    private readonly http: HttpClient,
    @Inject(API_BASE_URL) private readonly baseUrl: string
  ) {}

  lookupPublicRestaurant(
    input: PublicWaitlistLookupInput
  ): Observable<PublicWaitlistLookupResult> {
    return defer(() => {
      const sequence = ++this.lookupSequence;
      const restaurantSlug = input.restaurantSlug;
      this.selectedRestaurantSlug = undefined;
      const path = `/api/restaurants/${encodePathSegment(restaurantSlug)}`;
      return this.http.get<unknown>(apiUrl(this.baseUrl, path), {
        observe: 'response',
        withCredentials: true
      }).pipe(
        map((response) => {
          const result = mapSuccess(response, 200, isPublicLookupSuccess);
          if (sequence === this.lookupSequence && result.kind === 'success') {
            this.selectedRestaurantSlug = restaurantSlug;
          }
          return result;
        }),
        catchError((error: unknown) =>
          of(mapFailure<PublicWaitlistLookupResult>(error, [
            { status: 404, guard: isNotFoundFailure },
            { status: 500, guard: isUnexpectedFailure }
          ]))
        )
      );
    });
  }

  joinWaitlist(input: JoinWaitlistInput): Observable<JoinWaitlistResult> {
    return defer(() => {
      const slug = this.selectedRestaurantSlug;
      if (slug === undefined) {
        return of({ kind: 'not-found' } as const);
      }
      const path = `/api/restaurants/${encodePathSegment(slug)}/waitlist-entries`;
      return this.http.post<unknown>(apiUrl(this.baseUrl, path), {
        customerName: input.customerName,
        phone: input.phone,
        partySize: input.partySize
      }, {
        observe: 'response',
        withCredentials: true
      }).pipe(
        map((response) => mapSuccess(response, 201, isJoinSuccess)),
        catchError((error: unknown) =>
          of(mapFailure<JoinWaitlistResult>(error, [
            { status: 400, guard: isValidationFailure },
            { status: 404, guard: isNotFoundFailure },
            { status: 409, guard: isDuplicatePhoneFailure },
            { status: 500, guard: isUnexpectedFailure }
          ]))
        )
      );
    });
  }

  loadPrivateStatus(
    input: PrivateStatusLookupInput
  ): Observable<PrivateStatusResult> {
    const path = `/api/waitlist-entries/${encodePathSegment(input.privateToken)}`;
    return defer(() =>
      this.http.get<unknown>(apiUrl(this.baseUrl, path), {
        observe: 'response',
        withCredentials: true
      })
    ).pipe(
      map((response) => mapSuccess(response, 200, isPrivateStatus)),
      catchError((error: unknown) =>
        of(mapFailure<PrivateStatusResult>(error, [
          { status: 404, guard: isNotFoundFailure },
          { status: 500, guard: isUnexpectedFailure }
        ]))
      )
    );
  }

  cancelEntry(
    input: CancelWaitlistEntryInput
  ): Observable<CancelWaitlistEntryResult> {
    const path = `/api/waitlist-entries/${encodePathSegment(
      input.privateToken
    )}/cancellations`;
    return defer(() =>
      this.http.request<unknown>('POST', apiUrl(this.baseUrl, path), {
        observe: 'response',
        withCredentials: true
      })
    ).pipe(
      map((response) => mapSuccess(response, 200, isCancellationSuccess)),
      catchError((error: unknown) =>
        of(mapFailure<CancelWaitlistEntryResult>(error, [
          { status: 404, guard: isNotFoundFailure },
          { status: 500, guard: isUnexpectedFailure }
        ]))
      )
    );
  }
}
