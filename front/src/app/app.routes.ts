import { Routes } from '@angular/router';

import { NotFoundComponent } from './not-found.component';
import { PlaceholderPageComponent } from './placeholder-page.component';

export const routes: Routes = [
  {
    path: 'signup',
    component: PlaceholderPageComponent,
    data: { heading: 'Sign Up' }
  },
  {
    path: 'verify/:token',
    component: PlaceholderPageComponent,
    data: { heading: 'Verify Email' }
  },
  {
    path: 'dashboard',
    component: PlaceholderPageComponent,
    data: { heading: 'Restaurant Dashboard' }
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
