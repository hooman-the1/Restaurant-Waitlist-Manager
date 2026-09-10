import { CanMatchFn, Routes } from '@angular/router';

import { canAccessRestaurantDashboard } from './dashboard-access.guard';
import { NotFoundComponent } from './not-found.component';
import { PlaceholderPageComponent } from './placeholder-page.component';
import { RestaurantDashboardComponent } from './restaurant-dashboard.component';
import { RestaurantSignupComponent } from './restaurant-signup.component';
import { VerificationCallbackComponent } from './verification-callback.component';

const hasNonEmptyVerificationToken: CanMatchFn = (_route, segments) =>
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
    component: PlaceholderPageComponent,
    data: { heading: 'Join Waitlist' }
  },
  {
    path: 'status/:token',
    component: PlaceholderPageComponent,
    data: { heading: 'Customer Status' }
  },
  { path: '**', component: NotFoundComponent }
];
