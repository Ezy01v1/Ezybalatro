import { INestApplication, ValidationPipe } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import helmet from 'helmet';
import { Logger } from 'nestjs-pino';
import { ApiExceptionFilter } from './common/api-exception.filter';

/** Logger, security headers, global pipes and filters, and the docs; shared by main.ts and e2e tests. */
export function setupApp(app: INestApplication): void {
  app.useLogger(app.get(Logger));
  // Outside production the docs are opened over plain http on the LAN: no upgrade-insecure-requests / HSTS.
  const production = process.env.NODE_ENV === 'production';
  app.use(
    production
      ? helmet()
      : helmet({
          hsts: false,
          contentSecurityPolicy: {
            directives: { ...helmet.contentSecurityPolicy.getDefaultDirectives(), 'upgrade-insecure-requests': null },
          },
        }),
  );
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
  );
  app.useGlobalFilters(new ApiExceptionFilter());
  const document = SwaggerModule.createDocument(
    app,
    new DocumentBuilder()
      .setTitle('Naipes API')
      .setDescription('Errors: { "error": { "code", "message", "requestId" } }; `x-request-id` on every response.')
      .setVersion('1')
      .addBearerAuth()
      .build(),
  );
  SwaggerModule.setup('docs', app, document);
}
