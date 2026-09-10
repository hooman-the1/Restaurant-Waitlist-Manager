import { Component, DestroyRef, inject } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router } from '@angular/router';
import {
  catchError,
  defaultIfEmpty,
  defer,
  distinctUntilChanged,
  filter,
  map,
  of,
  switchMap,
  take
} from 'rxjs';

import { UNEXPECTED_ERROR_MESSAGE, VerificationResult } from './api-contracts';
import { RESTAURANT_ACCOUNT_SERVICE } from './service-boundary';

const INVALID_OR_USED_MESSAGE =
  'This verification link is invalid or has already been used.';
const UNEXPECTED_RESULT: VerificationResult = {
  kind: 'unexpected',
  message: UNEXPECTED_ERROR_MESSAGE
};

type VerificationState = 'pending' | 'invalid-or-used' | 'unexpected';

@Component({
  selector: 'app-verification-callback',
  standalone: true,
  template: '<p>{{ message }}</p>'
})
export class VerificationCallbackComponent {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly account = inject(RESTAURANT_ACCOUNT_SERVICE);
  private readonly destroyRef = inject(DestroyRef);

  private state: VerificationState = 'pending';

  constructor() {
    this.route.paramMap.pipe(
      map((parameters) => parameters.get('token')),
      filter((token): token is string => token !== null && token.length > 0),
      distinctUntilChanged(),
      switchMap((token) => {
        this.state = 'pending';

        return defer(() => this.account.verify({ token })).pipe(
          take(1),
          defaultIfEmpty(UNEXPECTED_RESULT),
          catchError(() => of(UNEXPECTED_RESULT))
        );
      }),
      takeUntilDestroyed(this.destroyRef)
    ).subscribe((result) => this.settle(result));
  }

  get message(): string {
    if (this.state === 'pending') {
      return 'Verifying…';
    }

    return this.state === 'invalid-or-used'
      ? INVALID_OR_USED_MESSAGE
      : UNEXPECTED_ERROR_MESSAGE;
  }

  private settle(result: VerificationResult): void {
    if (result.kind === 'success') {
      void this.router.navigateByUrl('/dashboard');
      return;
    }

    this.state = result.kind === 'invalid-or-used-token'
      ? 'invalid-or-used'
      : 'unexpected';
  }
}
