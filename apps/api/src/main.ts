import 'reflect-metadata';

import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import helmet from 'helmet';

import { AppModule } from './app.module';
import { PersianExceptionFilter } from './core/http/persian-exception.filter';
import { createPersianValidationPipe } from './core/http/validation-messages';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  const config = app.get(ConfigService);
  const logger = new Logger('Bootstrap');

  app.use(helmet());

  const prefix = config.get<string>('API_GLOBAL_PREFIX', 'api');
  app.setGlobalPrefix(prefix);

  app.enableCors({
    origin: config
      .get<string>('CORS_ORIGINS', 'http://localhost:3000')
      .split(',')
      .map((origin) => origin.trim()),
    credentials: true,
  });

  // Validation errors are the most user-visible text the API produces — they
  // render directly under form fields. This pipe discards class-validator's
  // English defaults entirely and emits Persian keyed by field name.
  // whitelist + forbidNonWhitelisted stay on: they are a tenancy control, not
  // just hygiene — they stop a client smuggling `buildingId` or `personId`
  // into a body that a service might otherwise spread into a Prisma call
  // (BM-00 rule 8).
  app.useGlobalPipes(createPersianValidationPipe());

  // Last line of defence: catches the responses NestJS generates itself
  // (404 "Cannot GET /x", 429, 500) and replaces the English with Persian.
  app.useGlobalFilters(new PersianExceptionFilter());

  app.enableShutdownHooks();

  if (config.get<string>('NODE_ENV') !== 'production') {
    const swaggerConfig = new DocumentBuilder()
      .setTitle('Building Operations Platform API')
      .setDescription('Multi-tenant building operations — BM-01 onward')
      .setVersion('0.1.0')
      .addBearerAuth()
      .build();
    SwaggerModule.setup(
      `${prefix}/docs`,
      app,
      SwaggerModule.createDocument(app, swaggerConfig),
    );
  }

  const port = config.get<number>('PORT', 3001);
  await app.listen(port);
  logger.log(`API listening on http://localhost:${port}/${prefix}`);
}

void bootstrap();
