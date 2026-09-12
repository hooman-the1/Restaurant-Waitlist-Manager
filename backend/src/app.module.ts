import { Module } from '@nestjs/common';

import { DemoDataSeeder, SystemClock } from './demo-data-seeder';
import { InMemoryStore } from './in-memory-store';

@Module({
  providers: [InMemoryStore, SystemClock, DemoDataSeeder],
  exports: [InMemoryStore],
})
export class AppModule {}
