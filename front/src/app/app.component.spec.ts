import { provideRouter, Router } from '@angular/router';
import { TestBed } from '@angular/core/testing';
import { NEVER, of } from 'rxjs';

import { AppComponent } from './app.component';
import { routes } from './app.routes';
import {
  CUSTOMER_WAITLIST_SERVICE,
  RESTAURANT_ACCOUNT_SERVICE,
  RESTAURANT_DASHBOARD_SERVICE,
  CustomerWaitlistService,
  RestaurantAccountService,
  RestaurantDashboardService
} from './service-boundary';

describe('AppComponent', () => {
  beforeEach(() =>
    TestBed.configureTestingModule({
      imports: [AppComponent],
      providers: [provideRouter([])]
    })
  );

  it('renders the shared semantic shell', () => {
    const fixture = TestBed.createComponent(AppComponent);

    fixture.detectChanges();

    const element = fixture.nativeElement as HTMLElement;
    expect(element.querySelector('header')?.textContent?.trim()).toBe(
      'Restaurant Waitlist Manager'
    );
    expect(element.querySelectorAll('main').length).toBe(1);
    expect(element.querySelector('main router-outlet')).not.toBeNull();
    expect(element.querySelector('footer')?.textContent?.trim()).toBe(
      'Restaurant Waitlist Manager'
    );
    expect(element.querySelector('header a, header button')).toBeNull();
    expect(element.querySelector('footer')?.children.length).toBe(0);
  });
});

describe('private status shared shell', () => {
  it('renders the private status route inside the unchanged header, main, and footer', async () => {
    const account = jasmine.createSpyObj<RestaurantAccountService>('RestaurantAccountService', [
      'signup', 'verify', 'checkDashboardAccess'
    ]);
    account.checkDashboardAccess.and.returnValue(of({ kind: 'allowed' }));
    const dashboard = jasmine.createSpyObj<RestaurantDashboardService>(
      'RestaurantDashboardService',
      ['loadDashboard', 'resolveEntry']
    );
    const waitlist = jasmine.createSpyObj<CustomerWaitlistService>('CustomerWaitlistService', [
      'lookupPublicRestaurant', 'joinWaitlist', 'loadPrivateStatus', 'cancelEntry'
    ]);
    waitlist.loadPrivateStatus.and.returnValue(NEVER);
    TestBed.configureTestingModule({
      imports: [AppComponent],
      providers: [
        provideRouter(routes),
        { provide: RESTAURANT_ACCOUNT_SERVICE, useValue: account },
        { provide: RESTAURANT_DASHBOARD_SERVICE, useValue: dashboard },
        { provide: CUSTOMER_WAITLIST_SERVICE, useValue: waitlist }
      ]
    });
    const fixture = TestBed.createComponent(AppComponent);

    await TestBed.inject(Router).navigateByUrl('/status/shell-token');
    fixture.detectChanges();
    await fixture.whenStable();

    const element = fixture.nativeElement as HTMLElement;
    expect(element.querySelector('header')?.textContent?.trim()).toBe(
      'Restaurant Waitlist Manager'
    );
    expect(element.querySelector('main')?.textContent?.trim()).toBe('Loading…');
    expect(element.querySelector('footer')?.textContent?.trim()).toBe(
      'Restaurant Waitlist Manager'
    );
  });
});
