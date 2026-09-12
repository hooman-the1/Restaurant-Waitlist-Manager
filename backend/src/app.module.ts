import { Module } from '@nestjs/common';

import { DemoDataSeeder, SystemClock } from './demo-data-seeder';
import { InMemoryStore } from './in-memory-store';
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

@Module({
  controllers: [
    RestaurantSignupController,
    RestaurantVerificationController,
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
  ],
  exports: [InMemoryStore],
})
export class AppModule {}
