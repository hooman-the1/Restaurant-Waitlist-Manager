import { CanMatchFn, Routes } from '@angular/router';

import { canAccessRestaurantDashboard } from './dashboard-access.guard';
import { NotFoundComponent } from './not-found.component';
import { PrivateStatusComponent } from './private-status.component';
import { PublicWaitlistJoinComponent } from './public-waitlist-join.component';
import { RestaurantDashboardComponent } from './restaurant-dashboard.component';
import { RestaurantSignupComponent } from './restaurant-signup.component';
import { VerificationCallbackComponent } from './verification-callback.component';

const hasNonEmptyVerificationToken: CanMatchFn = (_route, segments) =>
  segments.length === 2 && segments[1].path.length > 0;

const hasNonEmptyPrivateStatusToken: CanMatchFn = (_route, segments) =>
  segments.length === 2 && segments[1].path.length > 0;

export const routes: Routes = [
  {
    path: 'signup',
    component: RestaurantSignupComponent
  },
  {
    path: 'verify/:token',
    component: VerificationCallbackComponent,
    canMatch: [hasNonEmptyVerificationToken]
  },
  {
    path: 'dashboard',
    component: RestaurantDashboardComponent,
    canActivate: [canAccessRestaurantDashboard],
  },
  {
    path: 'restaurants/:slug',
    component: PublicWaitlistJoinComponent
  },
  {
    path: 'status/:token',
    component: PrivateStatusComponent,
    canMatch: [hasNonEmptyPrivateStatusToken]
  },
  { path: '**', component: NotFoundComponent }
];
