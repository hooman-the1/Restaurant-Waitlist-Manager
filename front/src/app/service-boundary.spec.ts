import { TestBed } from '@angular/core/testing';
import { firstValueFrom, of } from 'rxjs';

import {
  JoinWaitlistInput,
  StaffResolutionInput,
  VerificationInput
} from './api-contracts';
import {
  CUSTOMER_WAITLIST_SERVICE,
  CustomerWaitlistService,
  RESTAURANT_ACCOUNT_SERVICE,
  RESTAURANT_DASHBOARD_SERVICE,
  RestaurantAccountService,
  RestaurantDashboardService
} from './service-boundary';

describe('application service boundary', () => {
  it('resolves all three tokens without cross-wiring and delegates typed operations', async () => {
    const verificationInput: VerificationInput = { token: 'verification-token' };
    const resolutionInput: StaffResolutionInput = {
      actionReference: 'active-entry-reference' as StaffResolutionInput['actionReference'],
      resolution: 'seated'
    };
    const joinInput: JoinWaitlistInput = {
      customerName: 'A Customer',
      phone: '555-123-4567',
      partySize: 2
    };

    const account: jasmine.SpyObj<RestaurantAccountService> = jasmine.createSpyObj(
      'RestaurantAccountService',
      ['signup', 'verify', 'checkDashboardAccess']
    );
    account.verify.and.returnValue(of({ kind: 'invalid-or-used-token' }));

    const dashboard: jasmine.SpyObj<RestaurantDashboardService> = jasmine.createSpyObj(
      'RestaurantDashboardService',
      ['loadDashboard', 'resolveEntry']
    );
    dashboard.resolveEntry.and.returnValue(of({ kind: 'not-found' }));

    const customer: jasmine.SpyObj<CustomerWaitlistService> = jasmine.createSpyObj(
      'CustomerWaitlistService',
      ['lookupPublicRestaurant', 'joinWaitlist', 'loadPrivateStatus', 'cancelEntry']
    );
    customer.joinWaitlist.and.returnValue(
      of({ kind: 'success', privateStatusToken: 'private-status-token' })
    );

    TestBed.configureTestingModule({
      providers: [
        { provide: RESTAURANT_ACCOUNT_SERVICE, useValue: account },
        { provide: RESTAURANT_DASHBOARD_SERVICE, useValue: dashboard },
        { provide: CUSTOMER_WAITLIST_SERVICE, useValue: customer }
      ]
    });

    const injectedAccount = TestBed.inject(RESTAURANT_ACCOUNT_SERVICE);
    const injectedDashboard = TestBed.inject(RESTAURANT_DASHBOARD_SERVICE);
    const injectedCustomer = TestBed.inject(CUSTOMER_WAITLIST_SERVICE);

    expect(injectedAccount).toBe(account);
    expect(injectedDashboard).toBe(dashboard);
    expect(injectedCustomer).toBe(customer);
    expect(await firstValueFrom(injectedAccount.verify(verificationInput))).toEqual({
      kind: 'invalid-or-used-token'
    });
    expect(await firstValueFrom(injectedDashboard.resolveEntry(resolutionInput))).toEqual({
      kind: 'not-found'
    });
    expect(await firstValueFrom(injectedCustomer.joinWaitlist(joinInput))).toEqual({
      kind: 'success',
      privateStatusToken: 'private-status-token'
    });
    expect(account.verify).toHaveBeenCalledOnceWith(verificationInput);
    expect(dashboard.resolveEntry).toHaveBeenCalledOnceWith(resolutionInput);
    expect(customer.joinWaitlist).toHaveBeenCalledOnceWith(joinInput);
  });

  it('lets a consumer observe a replacement substitute through the same token', async () => {
    const first: Pick<RestaurantAccountService, 'checkDashboardAccess'> = {
      checkDashboardAccess: () => of({ kind: 'allowed' })
    };
    const second: Pick<RestaurantAccountService, 'checkDashboardAccess'> = {
      checkDashboardAccess: () => of({ kind: 'unauthorized' })
    };

    TestBed.configureTestingModule({
      providers: [{ provide: RESTAURANT_ACCOUNT_SERVICE, useValue: first }]
    });
    expect(
      await firstValueFrom(TestBed.inject(RESTAURANT_ACCOUNT_SERVICE).checkDashboardAccess())
    ).toEqual({ kind: 'allowed' });

    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [{ provide: RESTAURANT_ACCOUNT_SERVICE, useValue: second }]
    });
    expect(
      await firstValueFrom(TestBed.inject(RESTAURANT_ACCOUNT_SERVICE).checkDashboardAccess())
    ).toEqual({ kind: 'unauthorized' });
  });

  it('does not silently provide an implementation for an unconfigured token', () => {
    TestBed.configureTestingModule({});

    expect(() => TestBed.inject(RESTAURANT_ACCOUNT_SERVICE)).toThrowError(
      /No provider for InjectionToken RestaurantAccountService/
    );
  });
});
