import { Test } from '@nestjs/testing';

import { AppModule } from './app.module';

describe('AppModule', () => {
  it('compiles the empty NestJS application module', async () => {
    const module = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    expect(module).toBeDefined();

    await module.close();
  });
});
