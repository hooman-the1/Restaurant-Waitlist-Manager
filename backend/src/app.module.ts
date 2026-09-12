import { Module } from '@nestjs/common';

import { DemoDataSeeder, SystemClock } from './demo-data-seeder';
import { InMemoryStore } from './in-memory-store';
import { PublicRestaurantLookupController } from './public-restaurant-lookup';
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

@Module({
  controllers: [
    RestaurantSignupController,
    RestaurantVerificationController,
    RestaurantSessionController,
    PublicRestaurantLookupController,
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
  ],
  exports: [InMemoryStore, RestaurantSessionGuard],
})
export class AppModule {}
