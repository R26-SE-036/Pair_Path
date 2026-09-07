import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ValidationPipe } from '@nestjs/common';
import { assertRequiredEnv, corsOriginCallback } from './common/env';

async function bootstrap() {
  // Before anything binds a port or opens a connection: one clear message
  // about missing configuration, rather than an exception from whichever
  // module happened to initialise first.
  assertRequiredEnv();

  const app = await NestFactory.create(AppModule);

  // Browser origins allowed to call this API. A callback rather than a value,
  // so the list is read per request and stays in step with the gateway's -
  // see corsOriginCallback for why that matters there.
  app.enableCors({
    origin: corsOriginCallback,
    credentials: true,
  });

  // Global validation pipe
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  const port = process.env.PORT || 3001;
  await app.listen(port);
  console.log(`Application is running on: http://localhost:${port}`);
}
bootstrap();
