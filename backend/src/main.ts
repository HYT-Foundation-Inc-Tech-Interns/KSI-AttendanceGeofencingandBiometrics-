import { NestFactory } from '@nestjs/core';
import { ValidationPipe, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { NestExpressApplication } from '@nestjs/platform-express';
import helmet from 'helmet';
import compression from 'compression';
import { AppModule } from './app.module';
import { AllExceptionsFilter } from './common/filters/http-exception.filter';

async function bootstrap() {
  const logger = new Logger('Bootstrap');

  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    logger: ['error', 'warn', 'log', 'debug', 'verbose'],
  });

  const configService = app.get(ConfigService);

  /*
   * Request body limit.
   *
   * Check-in and biometric enrol carry a base64 face image inside the JSON
   * body (see attendance/dto/check-in.dto.ts and
   * biometric/dto/enroll-face.dto.ts). Express defaults to a 100 kB limit, so
   * a real phone photo was rejected before it ever reached a controller.
   *
   * The failure was also mislabelled: body-parser raises 413, but the global
   * AllExceptionsFilter flattens it to a generic 500 "request entity too
   * large", so the client could not tell it was a size problem. Measured
   * against the running server: a 90 kB body reached the auth guard (401), a
   * 110 kB body did not.
   *
   * `useBodyParser` registers a parser whose function name is `jsonParser` --
   * exactly the name Nest's own `registerParserMiddleware` checks via
   * `isMiddlewareApplied` -- so this replaces the 100 kB default rather than
   * stacking a second parser behind it.
   */
  const bodyLimit = configService.get<string>('BODY_LIMIT', '10mb');
  app.useBodyParser('json', { limit: bodyLimit });
  app.useBodyParser('urlencoded', { extended: true, limit: bodyLimit });

  // Security: Helmet
  app.use(helmet());

  // Compression
  app.use(compression());

  /*
   * CORS.
   *
   * The allowlist was hardcoded to localhost/LAN origins, so any deployed
   * dashboard (a *.pages.dev or custom domain) was rejected at preflight and
   * with `credentials: true` a wildcard is not a legal substitute.
   *
   * Production origins now come from CORS_ORIGINS (comma-separated). Note
   * that `backend/.env` already declared a CORS_ORIGINS variable, but nothing
   * read it -- setting it silently did nothing. It is now wired up.
   *
   * The LAN patterns are kept for local development only; they are anchored
   * to http:// and port 300[12], so they cannot match a public HTTPS origin.
   */
  const localOrigins = [
    'http://localhost:3001',
    'http://localhost:3002',
    'http://127.0.0.1:3001',
    'http://127.0.0.1:3002',
    'http://172.16.0.2:3001',
    'http://172.16.0.2:3002',
  ];

  const configuredOrigins = (
    configService.get<string>('CORS_ORIGINS') || ''
  )
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);

  const isProduction =
    (configService.get<string>('NODE_ENV') ?? process.env.NODE_ENV) ===
    'production';

  const devOnlyOrigins: (string | RegExp)[] = isProduction
    ? []
    : [/^https:\/\/[a-z0-9-]+\.trycloudflare\.com$/];

  app.enableCors({
    origin: [
      ...localOrigins,
      ...configuredOrigins,
      /^http:\/\/192\.168\.\d{1,3}\.\d{1,3}:300[12]$/,
      /^http:\/\/172\.\d{1,3}\.\d{1,3}\.\d{1,3}:300[12]$/,
      /*
       * Cloudflare quick tunnels -- development only.
       *
       * A quick tunnel gets a brand-new hostname every time it starts, so
       * pinning one in CORS_ORIGINS guarantees the dashboard breaks the next
       * time the tunnel is recreated -- which is exactly what happened, and
       * the failure is confusing: preflight returns 204 with the
       * credentials and headers it allows, but omits
       * Access-Control-Allow-Origin, which the browser treats as a hard
       * block.
       *
       * Allowing the whole namespace is tolerable as a development
       * affordance: authentication is a Bearer token read from localStorage,
       * never a cookie, so an unrelated origin gains no ambient authority.
       *
       * It is NOT tolerable in production, and the backend now has a
       * permanent Azure URL, so it is switched off there. The reason is the
       * `credentials: true` below: every allowed origin may send cookies,
       * and a trycloudflare.com hostname is free and instant for anyone to
       * obtain, so the allowlist would effectively be public. Production
       * origins belong in CORS_ORIGINS.
       */
      ...devOnlyOrigins,
    ],
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  });

  // Global prefix
  const apiPrefix = configService.get<string>('API_PREFIX', 'v1');
  app.setGlobalPrefix(apiPrefix);

  // Global validation pipe
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true, // Strip properties that don't have decorators
      forbidNonWhitelisted: true, // Throw error if non-whitelisted properties exist
      transform: true, // Auto-transform payloads to DTO instances
      transformOptions: {
        enableImplicitConversion: true,
      },
    }),
  );

  // Global exception filter
  app.useGlobalFilters(new AllExceptionsFilter());

  // Swagger API Documentation
  if (configService.get<string>('NODE_ENV') !== 'production') {
    const config = new DocumentBuilder()
      .setTitle('Klassic Field Attendance System API')
      .setDescription(
        'GPS-geofenced and biometric mobile timekeeping system API',
      )
      .setVersion('1.0')
      .addBearerAuth()
      .addTag('auth', 'Authentication and authorization')
      .addTag('employees', 'Employee management')
      .addTag('sites', 'Site and geofence management')
      .addTag('attendance', 'Check-in/check-out operations')
      .addTag('sync', 'Offline event synchronization')
      .addTag('admin', 'Administrative overrides')
      .addTag('payroll', 'Payroll export and reconciliation')
      .addTag('health', 'System health checks')
      .build();

    const document = SwaggerModule.createDocument(app, config);
    SwaggerModule.setup('api-docs', app, document);

    logger.log(
      `📚 API Documentation available at http://localhost:${configService.get('PORT', 3000)}/api-docs`,
    );
  }

  const port = configService.get<number>('PORT', 3000);
  await app.listen(port, '0.0.0.0'); // Listen on all network interfaces

  logger.log(`🚀 Application is running on: http://localhost:${port}/${apiPrefix}`);
  logger.log(`🌐 Network access: http://0.0.0.0:${port}/${apiPrefix}`);
  logger.log(`🔒 Environment: ${configService.get('NODE_ENV', 'development')}`);
}

bootstrap();
