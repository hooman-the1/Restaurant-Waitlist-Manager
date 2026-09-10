import { CommonModule } from '@angular/common';
import { Component, DestroyRef, inject } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Router } from '@angular/router';
import { catchError, defaultIfEmpty, defer, of, take } from 'rxjs';

import {
  ActiveEntryActionReference,
  DashboardLoadResult,
  DashboardView,
  FinalStatus,
  StaffResolution,
  StaffResolutionResult,
  UNEXPECTED_ERROR_MESSAGE
} from './api-contracts';
import { RESTAURANT_DASHBOARD_SERVICE } from './service-boundary';

const UNEXPECTED_RESULT: DashboardLoadResult = {
  kind: 'unexpected',
  message: UNEXPECTED_ERROR_MESSAGE
};

const UNEXPECTED_RESOLUTION_RESULT: StaffResolutionResult = {
  kind: 'unexpected',
  message: UNEXPECTED_ERROR_MESSAGE
};

type DashboardState = 'loading' | 'success' | 'error' | 'redirecting';

@Component({
  selector: 'app-restaurant-dashboard',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './restaurant-dashboard.component.html',
  styleUrls: ['./restaurant-dashboard.component.css']
})
export class RestaurantDashboardComponent {
  private readonly dashboardService = inject(RESTAURANT_DASHBOARD_SERVICE);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);

  protected state: DashboardState = 'loading';
  protected dashboard: DashboardView | null = null;
  protected readonly unexpectedErrorMessage = UNEXPECTED_ERROR_MESSAGE;
  protected actionError = false;
  protected reconciliationPending = false;

  private readonly pendingActionReferences = new Set<ActiveEntryActionReference>();
  private readonly lockedActionReferences = new Set<ActiveEntryActionReference>();
  private readonly selectedResolutions = new Map<ActiveEntryActionReference, StaffResolution>();
  private readonly actionSelects = new Map<ActiveEntryActionReference, HTMLSelectElement>();
  private reconciliationRequired = false;

  constructor() {
    this.requestDashboard();
  }

  refresh(): void {
    if (this.refreshDisabled()) {
      return;
    }

    this.requestDashboard();
  }

  protected refreshDisabled(): boolean {
    return this.state === 'loading' ||
      this.pendingActionReferences.size > 0 ||
      this.reconciliationPending;
  }

  protected resolveEntry(
    actionReference: ActiveEntryActionReference,
    value: string,
    select?: HTMLSelectElement
  ): void {
    if (!this.isStaffResolution(value) ||
        this.state !== 'success' ||
        this.reconciliationPending ||
        this.pendingActionReferences.has(actionReference) ||
        this.lockedActionReferences.has(actionReference) ||
        !this.dashboard?.activeEntries.some(
          (entry) => entry.actionReference === actionReference
        )) {
      return;
    }

    this.actionError = false;
    this.selectedResolutions.set(actionReference, value);
    if (select) {
      this.actionSelects.set(actionReference, select);
    }
    this.pendingActionReferences.add(actionReference);

    defer(() => this.dashboardService.resolveEntry({
      actionReference,
      resolution: value
    })).pipe(
      take(1),
      defaultIfEmpty(UNEXPECTED_RESOLUTION_RESULT),
      catchError(() => of(UNEXPECTED_RESOLUTION_RESULT)),
      takeUntilDestroyed(this.destroyRef)
    ).subscribe((result) => this.settleResolution(actionReference, result));
  }

  protected actionDisabled(actionReference: ActiveEntryActionReference): boolean {
    return this.reconciliationPending ||
      this.pendingActionReferences.has(actionReference) ||
      this.lockedActionReferences.has(actionReference);
  }

  protected selectedResolution(actionReference: ActiveEntryActionReference): string {
    return this.selectedResolutions.get(actionReference) ?? '';
  }

  protected statusLabel(status: FinalStatus): string {
    switch (status) {
      case 'seated':
        return 'Seated';
      case 'cancelled':
        return 'Cancelled';
      case 'no-show':
        return 'No-show';
    }
  }

  private requestDashboard(): void {
    this.state = 'loading';
    this.dashboard = null;
    this.actionError = false;
    this.lockedActionReferences.clear();
    this.selectedResolutions.clear();
    this.actionSelects.clear();

    defer(() => this.dashboardService.loadDashboard()).pipe(
      take(1),
      defaultIfEmpty(UNEXPECTED_RESULT),
      catchError(() => of(UNEXPECTED_RESULT)),
      takeUntilDestroyed(this.destroyRef)
    ).subscribe((result) => this.settleDashboard(result));
  }

  private settleDashboard(result: DashboardLoadResult): void {
    if (result.kind === 'success') {
      this.dashboard = result.dashboard;
      this.state = 'success';
      this.actionError = false;
      this.lockedActionReferences.clear();
      this.selectedResolutions.clear();
      this.actionSelects.clear();
      return;
    }

    if (result.kind === 'unauthorized') {
      this.redirectHome();
      return;
    }

    this.state = 'error';
  }

  private settleResolution(
    actionReference: ActiveEntryActionReference,
    result: StaffResolutionResult
  ): void {
    this.pendingActionReferences.delete(actionReference);

    if (this.state === 'redirecting') {
      return;
    }

    if (result.kind === 'unauthorized') {
      this.redirectHome();
      return;
    }

    if (result.kind === 'success' || result.kind === 'not-found') {
      this.lockedActionReferences.add(actionReference);
      this.reconciliationRequired = true;
    } else {
      this.selectedResolutions.delete(actionReference);
      const select = this.actionSelects.get(actionReference);
      if (select) {
        select.value = '';
      }
      this.actionSelects.delete(actionReference);
      this.actionError = true;
    }

    if (this.pendingActionReferences.size === 0 && this.reconciliationRequired) {
      this.reconcileDashboard();
    }
  }

  private reconcileDashboard(): void {
    this.reconciliationRequired = false;
    this.reconciliationPending = true;

    defer(() => this.dashboardService.loadDashboard()).pipe(
      take(1),
      defaultIfEmpty(UNEXPECTED_RESULT),
      catchError(() => of(UNEXPECTED_RESULT)),
      takeUntilDestroyed(this.destroyRef)
    ).subscribe((result) => this.settleReconciliation(result));
  }

  private settleReconciliation(result: DashboardLoadResult): void {
    this.reconciliationPending = false;

    if (this.state === 'redirecting') {
      return;
    }

    if (result.kind === 'unauthorized') {
      this.redirectHome();
      return;
    }

    if (result.kind === 'success') {
      this.dashboard = result.dashboard;
      this.actionError = false;
      this.lockedActionReferences.clear();
      this.selectedResolutions.clear();
      this.actionSelects.clear();
      return;
    }

    this.actionError = true;
  }

  private redirectHome(): void {
    this.state = 'redirecting';
    this.dashboard = null;
    this.actionError = false;
    this.reconciliationPending = false;
    this.reconciliationRequired = false;
    this.pendingActionReferences.clear();
    this.lockedActionReferences.clear();
    this.selectedResolutions.clear();
    this.actionSelects.clear();
    void this.router.navigateByUrl('/');
  }

  private isStaffResolution(value: string): value is StaffResolution {
    return value === 'seated' || value === 'cancelled' || value === 'no-show';
  }
}
