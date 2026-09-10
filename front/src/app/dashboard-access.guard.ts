import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { catchError, defaultIfEmpty, defer, map, of, take } from 'rxjs';

import { RESTAURANT_ACCOUNT_SERVICE } from './service-boundary';

export const canAccessRestaurantDashboard: CanActivateFn = () => {
  const accountService = inject(RESTAURANT_ACCOUNT_SERVICE);
  const fallback = inject(Router).parseUrl('/');

  return defer(() => accountService.checkDashboardAccess()).pipe(
    take(1),
    map((result) => (result.kind === 'allowed' ? true : fallback)),
    defaultIfEmpty(fallback),
    catchError(() => of(fallback))
  );
};
