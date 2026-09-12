import { HttpClient } from '@angular/common/http';
import { Inject, Injectable } from '@angular/core';
import { catchError, defer, map, Observable, of } from 'rxjs';

import {
  DashboardLoadResult,
  StaffResolutionInput,
  StaffResolutionResult
} from './api-contracts';
import { API_BASE_URL, apiUrl, encodePathSegment } from './api-base-url';
import {
  isDashboardLoadSuccess,
  isNotFoundFailure,
  isSuccess,
  isUnauthorizedFailure,
  isUnexpectedFailure,
  mapFailure,
  mapSuccess
} from './http-result-mapping';
import { RestaurantDashboardService } from './service-boundary';

@Injectable()
export class HttpRestaurantDashboardService
  implements RestaurantDashboardService {
  constructor(
    private readonly http: HttpClient,
    @Inject(API_BASE_URL) private readonly baseUrl: string
  ) {}

  loadDashboard(): Observable<DashboardLoadResult> {
    return defer(() =>
      this.http.get<unknown>(apiUrl(this.baseUrl, '/api/dashboard'), {
        observe: 'response',
        withCredentials: true
      })
    ).pipe(
      map((response) => mapSuccess(response, 200, isDashboardLoadSuccess)),
      catchError((error: unknown) =>
        of(mapFailure<DashboardLoadResult>(error, [
          { status: 401, guard: isUnauthorizedFailure },
          { status: 500, guard: isUnexpectedFailure }
        ]))
      )
    );
  }

  resolveEntry(input: StaffResolutionInput): Observable<StaffResolutionResult> {
    const path = `/api/dashboard/waitlist-entries/${encodePathSegment(
      input.actionReference
    )}`;
    return defer(() =>
      this.http.patch<unknown>(apiUrl(this.baseUrl, path), {
        resolution: input.resolution
      }, {
        observe: 'response',
        withCredentials: true
      })
    ).pipe(
      map((response) => mapSuccess(response, 200, isSuccess)),
      catchError((error: unknown) =>
        of(mapFailure<StaffResolutionResult>(error, [
          { status: 401, guard: isUnauthorizedFailure },
          { status: 404, guard: isNotFoundFailure },
          { status: 500, guard: isUnexpectedFailure }
        ]))
      )
    );
  }
}
