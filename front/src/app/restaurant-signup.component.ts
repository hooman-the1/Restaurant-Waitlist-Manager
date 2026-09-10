import { NgIf } from '@angular/common';
import { Component, inject, ViewChild } from '@angular/core';
import { FormsModule, NgForm } from '@angular/forms';
import { take } from 'rxjs';

import {
  RestaurantSignupInput,
  RestaurantSignupResult,
  UNEXPECTED_ERROR_MESSAGE
} from './api-contracts';
import { RESTAURANT_ACCOUNT_SERVICE } from './service-boundary';

@Component({
  selector: 'app-restaurant-signup',
  standalone: true,
  imports: [FormsModule, NgIf],
  templateUrl: './restaurant-signup.component.html',
  styleUrls: ['./restaurant-signup.component.css']
})
export class RestaurantSignupComponent {
  @ViewChild(NgForm) private form?: NgForm;

  restaurantName = '';
  email = '';
  password = '';
  isPending = false;
  isSuccessful = false;
  errorMessage: string | null = null;

  private readonly accountService = inject(RESTAURANT_ACCOUNT_SERVICE);

  submit(): void {
    if (this.isPending) {
      return;
    }

    const input: RestaurantSignupInput = {
      restaurantName: this.restaurantName,
      email: this.email,
      password: this.password
    };

    this.isPending = true;
    this.errorMessage = null;

    this.accountService.signup(input).pipe(take(1)).subscribe({
      next: (result) => this.handleResult(result),
      error: () => this.handleUnexpectedFailure(),
      complete: () => {
        if (this.isPending) {
          this.handleUnexpectedFailure();
        }
      }
    });
  }

  private handleResult(result: RestaurantSignupResult): void {
    this.isPending = false;
    this.password = '';

    if (result.kind === 'success') {
      this.isSuccessful = true;
      return;
    }

    this.errorMessage =
      result.kind === 'validation' ? result.message : UNEXPECTED_ERROR_MESSAGE;
    this.resetFailedForm();
  }

  private handleUnexpectedFailure(): void {
    this.isPending = false;
    this.password = '';
    this.errorMessage = UNEXPECTED_ERROR_MESSAGE;
    this.resetFailedForm();
  }

  private resetFailedForm(): void {
    this.form?.resetForm({
      restaurantName: this.restaurantName,
      email: this.email,
      password: ''
    });
  }
}
