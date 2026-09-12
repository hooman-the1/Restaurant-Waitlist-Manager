import { INestApplication, ValidationPipe } from '@nestjs/common';
import cookieParser = require('cookie-parser');

import { ApiExceptionFilter } from './api-failures';
import { RuntimeConfiguration } from './runtime-configuration';

export function configureApplication(
  app: INestApplication,
  configuration: RuntimeConfiguration,
): void {
  app.enableCors({
    credentials: true,
    origin: (
      origin: string | undefined,
      callback: (error: Error | null, allow?: boolean) => void,
    ) => {
      callback(
        null,
        origin === undefined || origin === configuration.frontendOrigin,
      );
    },
  });
  app.use(cookieParser(configuration.secretKey));
  app.useGlobalFilters(new ApiExceptionFilter());
  app.useGlobalPipes(
    new ValidationPipe({
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: false },
      whitelist: true,
    }),
  );
}
