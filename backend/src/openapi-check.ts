import { ConfigModule } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';

import {
  assertOpenApiParity,
  createNestOpenApiDocument,
  loadAuthoritativeOpenApiDocument,
} from './api-documentation';
import { AppModule } from './app.module';

async function checkOpenApiContract(): Promise<void> {
  const app = await NestFactory.create(
    {
      module: AppModule,
      imports: [ConfigModule.forRoot({ ignoreEnvFile: true })],
    },
    { abortOnError: false, logger: false },
  );
  try {
    const generated = createNestOpenApiDocument(app);
    assertOpenApiParity(generated, loadAuthoritativeOpenApiDocument());
    process.stdout.write('OpenAPI contract parity check passed.\n');
  } finally {
    await app.close();
  }
}

void checkOpenApiContract().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : 'OpenAPI check failed.';
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
