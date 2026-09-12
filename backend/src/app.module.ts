import { Module } from '@nestjs/common';

import { InMemoryStore } from './in-memory-store';

@Module({
  providers: [InMemoryStore],
  exports: [InMemoryStore],
})
export class AppModule {}
