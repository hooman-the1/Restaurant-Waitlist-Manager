import { NgIf } from '@angular/common';
import { Component, inject, OnDestroy, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { Title } from '@angular/platform-browser';
import {
  catchError,
  defaultIfEmpty,
  map,
  Observable,
  of,
  Subject,
  Subscription,
  switchMap,
  take,
  takeUntil,
  tap
} from 'rxjs';

import {
  DUPLICATE_PHONE_MESSAGE,
  JoinWaitlistInput,
  JoinWaitlistResult,
  PublicWaitlistLookupResult,
  UNEXPECTED_ERROR_MESSAGE
} from './api-contracts';
import { CUSTOMER_WAITLIST_SERVICE } from './service-boundary';

@Component({
  selector: 'app-public-waitlist-join',
  standalone: true,
  imports: [FormsModule, NgIf],
  templateUrl: './public-waitlist-join.component.html',
  styleUrls: ['./public-waitlist-join.component.css']
})
export class PublicWaitlistJoinComponent implements OnInit, OnDestroy {
  customerName = '';
  phone = '';
  partySize = 1;
  restaurantName: string | null = null;
  lookupError: string | null = null;
  formError: string | null = null;
  isLookupPending = true;
  isJoinPending = false;

  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly title = inject(Title);
  private readonly waitlist = inject(CUSTOMER_WAITLIST_SERVICE);
  private readonly destroyed = new Subject<void>();
  private readonly prePageTitle = this.title.getTitle();
  private joinSubscription: Subscription | null = null;

  get isAvailable(): boolean {
    return this.restaurantName !== null;
  }

  ngOnInit(): void {
    this.route.paramMap
      .pipe(
        map((parameters) => parameters.get('slug') ?? ''),
        tap(() => this.prepareForLookup()),
        switchMap((restaurantSlug) => this.lookup(restaurantSlug)),
        takeUntil(this.destroyed)
      )
      .subscribe((result) => this.handleLookupResult(result));
  }

  ngOnDestroy(): void {
    this.joinSubscription?.unsubscribe();
    this.destroyed.next();
    this.destroyed.complete();
    this.title.setTitle(this.prePageTitle);
  }

  submit(): void {
    if (!this.isAvailable || this.isJoinPending) {
      return;
    }

    const input: JoinWaitlistInput = {
      customerName: this.customerName,
      phone: this.phone,
      partySize: this.partySize
    };
    this.isJoinPending = true;
    this.formError = null;

    let request: Observable<JoinWaitlistResult>;
    try {
      request = this.waitlist.joinWaitlist(input);
    } catch {
      this.handleUnexpectedJoinFailure();
      return;
    }

    this.joinSubscription = request
      .pipe(
        take(1),
        defaultIfEmpty(this.unexpectedJoinResult()),
        catchError(() => of(this.unexpectedJoinResult()))
      )
      .subscribe((result) => this.handleJoinResult(result));
  }

  private prepareForLookup(): void {
    this.joinSubscription?.unsubscribe();
    this.joinSubscription = null;
    this.customerName = '';
    this.phone = '';
    this.partySize = 1;
    this.restaurantName = null;
    this.lookupError = null;
    this.formError = null;
    this.isLookupPending = true;
    this.isJoinPending = false;
    this.title.setTitle(this.prePageTitle);
  }

  private lookup(restaurantSlug: string): Observable<PublicWaitlistLookupResult> {
    try {
      return this.waitlist.lookupPublicRestaurant({ restaurantSlug }).pipe(
        take(1),
        defaultIfEmpty(this.unexpectedLookupResult()),
        catchError(() => of(this.unexpectedLookupResult()))
      );
    } catch {
      return of(this.unexpectedLookupResult());
    }
  }

  private handleLookupResult(result: PublicWaitlistLookupResult): void {
    this.isLookupPending = false;

    if (result.kind === 'success') {
      this.restaurantName = result.restaurant.restaurantName;
      this.title.setTitle(result.restaurant.restaurantName);
      return;
    }

    this.restaurantName = null;
    if (result.kind === 'not-found') {
      void this.router.navigateByUrl('/');
      return;
    }

    this.lookupError = UNEXPECTED_ERROR_MESSAGE;
  }

  private handleJoinResult(result: JoinWaitlistResult): void {
    this.isJoinPending = false;

    if (result.kind === 'success') {
      if (!result.privateStatusToken) {
        this.handleUnexpectedJoinFailure();
        return;
      }
      void this.router.navigate(['/status', result.privateStatusToken]);
      return;
    }

    if (result.kind === 'not-found') {
      this.restaurantName = null;
      void this.router.navigateByUrl('/');
      return;
    }

    this.formError =
      result.kind === 'validation'
        ? result.message
        : result.kind === 'duplicate-phone'
          ? DUPLICATE_PHONE_MESSAGE
          : UNEXPECTED_ERROR_MESSAGE;
  }

  private handleUnexpectedJoinFailure(): void {
    this.isJoinPending = false;
    this.formError = UNEXPECTED_ERROR_MESSAGE;
  }

  private unexpectedLookupResult(): PublicWaitlistLookupResult {
    return { kind: 'unexpected', message: UNEXPECTED_ERROR_MESSAGE };
  }

  private unexpectedJoinResult(): JoinWaitlistResult {
    return { kind: 'unexpected', message: UNEXPECTED_ERROR_MESSAGE };
  }
}
