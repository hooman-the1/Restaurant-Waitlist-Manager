import { ConfigService } from '@nestjs/config';

import { createApplication } from './application';
import { readRuntimeConfiguration } from './runtime-configuration';

async function bootstrap(): Promise<void> {
  const app = await createApplication();
  const configuration = readRuntimeConfiguration(app.get(ConfigService));

  await app.listen(configuration.port);
}

void bootstrap().catch((error: unknown) => {
  const message =
    error instanceof Error ? error.message : 'Configuration error.';

  console.error(message);
  process.exitCode = 1;
});
