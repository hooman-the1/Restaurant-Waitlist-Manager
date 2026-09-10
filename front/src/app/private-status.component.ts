import { NgIf, NgSwitch, NgSwitchCase } from '@angular/common';
import { Component, inject, OnDestroy, OnInit } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
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
  tap,
  timer
} from 'rxjs';

import {
  ActivePrivateStatusView,
  CancelWaitlistEntryResult,
  PrivateStatusResult,
  ResolvedPrivateStatusView,
  UNEXPECTED_ERROR_MESSAGE
} from './api-contracts';
import { CUSTOMER_WAITLIST_SERVICE } from './service-boundary';

@Component({
  selector: 'app-private-status',
  standalone: true,
  imports: [NgIf, NgSwitch, NgSwitchCase],
  templateUrl: './private-status.component.html',
  styleUrls: ['./private-status.component.css']
})
export class PrivateStatusComponent implements OnInit, OnDestroy {
  activeStatus: ActivePrivateStatusView | null = null;
  resolvedStatus: ResolvedPrivateStatusView | null = null;
  lookupError: string | null = null;
  cancellationError: string | null = null;
  isLookupPending = true;
  isCancellationPending = false;

  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly waitlist = inject(CUSTOMER_WAITLIST_SERVICE);
  private readonly destroyed = new Subject<void>();
  private cancellationSubscription: Subscription | null = null;
  private pollingTimerSubscription: Subscription | null = null;
  private automaticLookupSubscription: Subscription | null = null;
  private isAutomaticLookupPending = false;
  private activeToken: string | null = null;
  private lookupToken: string | null = null;

  ngOnInit(): void {
    this.route.paramMap
      .pipe(
        map((parameters) => parameters.get('token') ?? ''),
        tap((privateToken) => this.prepareForLookup(privateToken)),
        switchMap((privateToken) => this.lookup(privateToken)),
        takeUntil(this.destroyed)
      )
      .subscribe((result) => this.handleInitialLookupResult(result));
  }

  ngOnDestroy(): void {
    this.stopPolling();
    this.cancellationSubscription?.unsubscribe();
    this.destroyed.next();
    this.destroyed.complete();
  }

  cancel(): void {
    const active = this.activeStatus;
    const privateToken = this.activeToken;
    if (active === null || privateToken === null || this.isCancellationPending) {
      return;
    }

    this.cancelAutomaticLookup();
    this.isCancellationPending = true;
    this.cancellationError = null;

    let request: Observable<CancelWaitlistEntryResult>;
    try {
      request = this.waitlist.cancelEntry({ privateToken });
    } catch {
      this.handleUnexpectedCancellationFailure();
      return;
    }

    this.cancellationSubscription = request
      .pipe(
        take(1),
        defaultIfEmpty(this.unexpectedCancellationResult()),
        catchError(() => of(this.unexpectedCancellationResult()))
      )
      .subscribe((result) => this.handleCancellationResult(result, active));
  }

  private prepareForLookup(privateToken: string): void {
    this.stopPolling();
    this.cancellationSubscription?.unsubscribe();
    this.cancellationSubscription = null;
    this.clearPrivateState();
    this.lookupToken = privateToken;
    this.isLookupPending = true;
  }

  private lookup(privateToken: string): Observable<PrivateStatusResult> {
    try {
      return this.waitlist.loadPrivateStatus({ privateToken }).pipe(
        take(1),
        defaultIfEmpty(this.unexpectedLookupResult()),
        catchError(() => of(this.unexpectedLookupResult()))
      );
    } catch {
      return of(this.unexpectedLookupResult());
    }
  }

  private handleInitialLookupResult(result: PrivateStatusResult): void {
    this.isLookupPending = false;

    if (result.kind === 'active') {
      this.activeStatus = result;
      this.activeToken = this.lookupToken;
      if (this.activeToken !== null) {
        this.startPolling(this.activeToken);
      }
      return;
    }

    if (result.kind === 'resolved') {
      this.resolvedStatus = result;
      return;
    }

    if (result.kind === 'not-found') {
      this.clearPrivateState();
      void this.router.navigateByUrl('/');
      return;
    }

    this.lookupError = UNEXPECTED_ERROR_MESSAGE;
  }

  private startPolling(privateToken: string): void {
    this.pollingTimerSubscription = timer(30_000, 30_000)
      .pipe(takeUntil(this.destroyed))
      .subscribe(() => this.poll(privateToken));
  }

  private poll(privateToken: string): void {
    if (
      this.activeStatus === null ||
      this.activeToken !== privateToken ||
      this.isAutomaticLookupPending ||
      this.isCancellationPending
    ) {
      return;
    }

    this.isAutomaticLookupPending = true;
    this.automaticLookupSubscription = this.lookup(privateToken).subscribe((result) =>
      this.handleAutomaticLookupResult(result)
    );
  }

  private handleAutomaticLookupResult(result: PrivateStatusResult): void {
    this.isAutomaticLookupPending = false;

    if (result.kind === 'active') {
      this.activeStatus = result;
      this.lookupError = null;
      return;
    }

    if (result.kind === 'resolved') {
      this.stopPolling();
      this.activeStatus = null;
      this.activeToken = null;
      this.lookupError = null;
      this.cancellationError = null;
      this.resolvedStatus = result;
      return;
    }

    if (result.kind === 'not-found') {
      this.stopPolling();
      this.clearPrivateState();
      void this.router.navigateByUrl('/');
      return;
    }

    this.lookupError = UNEXPECTED_ERROR_MESSAGE;
  }

  private cancelAutomaticLookup(): void {
    this.automaticLookupSubscription?.unsubscribe();
    this.automaticLookupSubscription = null;
    this.isAutomaticLookupPending = false;
  }

  private stopPolling(): void {
    this.pollingTimerSubscription?.unsubscribe();
    this.pollingTimerSubscription = null;
    this.cancelAutomaticLookup();
  }

  private handleCancellationResult(
    result: CancelWaitlistEntryResult,
    active: ActivePrivateStatusView
  ): void {
    this.isCancellationPending = false;

    if (result.kind === 'cancelled') {
      this.stopPolling();
      this.activeStatus = null;
      this.activeToken = null;
      this.cancellationError = null;
      this.resolvedStatus = {
        kind: 'resolved',
        restaurantName: active.restaurantName,
        finalStatus: 'cancelled'
      };
      return;
    }

    if (result.kind === 'not-found') {
      this.stopPolling();
      this.clearPrivateState();
      void this.router.navigateByUrl('/');
      return;
    }

    this.cancellationError = UNEXPECTED_ERROR_MESSAGE;
  }

  private handleUnexpectedCancellationFailure(): void {
    this.isCancellationPending = false;
    this.cancellationError = UNEXPECTED_ERROR_MESSAGE;
  }

  private clearPrivateState(): void {
    this.activeStatus = null;
    this.resolvedStatus = null;
    this.activeToken = null;
    this.lookupToken = null;
    this.lookupError = null;
    this.cancellationError = null;
    this.isLookupPending = false;
    this.isCancellationPending = false;
  }

  private unexpectedLookupResult(): PrivateStatusResult {
    return { kind: 'unexpected', message: UNEXPECTED_ERROR_MESSAGE };
  }

  private unexpectedCancellationResult(): CancelWaitlistEntryResult {
    return { kind: 'unexpected', message: UNEXPECTED_ERROR_MESSAGE };
  }
}
