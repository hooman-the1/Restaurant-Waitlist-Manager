import { CommonModule } from '@angular/common';
import { Component, DestroyRef, inject } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Router } from '@angular/router';
import { catchError, defaultIfEmpty, defer, of, take } from 'rxjs';

import {
  DashboardLoadResult,
  DashboardView,
  FinalStatus,
  UNEXPECTED_ERROR_MESSAGE
} from './api-contracts';
import { RESTAURANT_DASHBOARD_SERVICE } from './service-boundary';

const UNEXPECTED_RESULT: DashboardLoadResult = {
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

  constructor() {
    this.requestDashboard();
  }

  refresh(): void {
    if (this.state === 'loading') {
      return;
    }

    this.requestDashboard();
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

    defer(() => this.dashboardService.loadDashboard()).pipe(
      take(1),
      defaultIfEmpty(UNEXPECTED_RESULT),
      catchError(() => of(UNEXPECTED_RESULT)),
      takeUntilDestroyed(this.destroyRef)
    ).subscribe((result) => this.settle(result));
  }

  private settle(result: DashboardLoadResult): void {
    if (result.kind === 'success') {
      this.dashboard = result.dashboard;
      this.state = 'success';
      return;
    }

    if (result.kind === 'unauthorized') {
      this.state = 'redirecting';
      void this.router.navigateByUrl('/');
      return;
    }

    this.state = 'error';
  }
}
