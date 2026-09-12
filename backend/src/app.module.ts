import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';

import {
  DashboardController,
  DashboardNoStoreGuard,
  StaffWaitlistResolutionController,
} from './dashboard';
import { DemoDataSeeder, SystemClock } from './demo-data-seeder';
import { InMemoryStore } from './in-memory-store';
import { PrivateWaitlistStatusController } from './private-waitlist-status';
import { PublicRestaurantLookupController } from './public-restaurant-lookup';
import {
  ActionReferenceSource,
  PrivateStatusTokenSource,
  PublicWaitlistJoinController,
} from './public-waitlist-join';
import {
  FrontendOrigin,
  PasswordHasher,
  RestaurantSignupController,
  VerificationTokenSource,
  VerificationUrlLogger,
} from './restaurant-signup';
import {
  RestaurantSessionSigner,
  RestaurantVerificationController,
  VerificationDtoFailureInterceptor,
} from './restaurant-verification';
import {
  RestaurantSessionController,
  RestaurantSessionGuard,
} from './restaurant-session';
import {
  CleanupFailureReporter,
  ResolvedEntryCleanup,
} from './resolved-entry-cleanup';

@Module({
  imports: [ScheduleModule.forRoot()],
  controllers: [
    RestaurantSignupController,
    RestaurantVerificationController,
    RestaurantSessionController,
    PublicRestaurantLookupController,
    PublicWaitlistJoinController,
    PrivateWaitlistStatusController,
    DashboardController,
    StaffWaitlistResolutionController,
  ],
  providers: [
    InMemoryStore,
    SystemClock,
    DemoDataSeeder,
    PasswordHasher,
    VerificationTokenSource,
    FrontendOrigin,
    VerificationUrlLogger,
    RestaurantSessionSigner,
    VerificationDtoFailureInterceptor,
    RestaurantSessionGuard,
    PrivateStatusTokenSource,
    ActionReferenceSource,
    DashboardNoStoreGuard,
    CleanupFailureReporter,
    ResolvedEntryCleanup,
  ],
  exports: [InMemoryStore, RestaurantSessionGuard],
})
export class AppModule {}
