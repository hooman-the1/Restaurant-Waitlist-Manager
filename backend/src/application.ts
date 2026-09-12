import { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';

import { configureApplication } from './application-configuration';
import { AppModule } from './app.module';
import {
  createRuntimeConfigurationModule,
  readRuntimeConfiguration,
} from './runtime-configuration';

export async function createApplication(): Promise<INestApplication> {
  const runtimeConfigurationModule = await createRuntimeConfigurationModule();
  const app = await NestFactory.create(
    {
      module: AppModule,
      imports: [runtimeConfigurationModule],
    },
    {
      abortOnError: false,
    },
  );
  const configuration = readRuntimeConfiguration(app.get(ConfigService));

  configureApplication(app, configuration);

  return app;
}
