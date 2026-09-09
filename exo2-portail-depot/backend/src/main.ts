import { ValidationPipe, Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import cookieParser from 'cookie-parser';
import { AppModule } from './app.module';
import { createHttpMetricsMiddleware } from './metrics/http-metrics.middleware';
import { MetricsService } from './metrics/metrics.service';
import type { Env } from './config/env.validation';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  const config = app.get(ConfigService<Env, true>);

  // Tout est prefixe /api : en production, nginx route /api/* vers ce service
  // et / vers le frontend, sur un hostname unique.
  app.setGlobalPrefix('api');

  app.use(cookieParser());

  // Pose AVANT les pipes et les gardes : une requete rejetee en 400 ou en 401
  // est une requete a mesurer, pas une requete a ignorer.
  app.use(createHttpMetricsMiddleware(app.get(MetricsService)));

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true, // les champs non declares sont supprimes
      forbidNonWhitelisted: true, // ... et un champ inconnu est une erreur 400
      transform: true, // applique les conversions de type des DTO
    }),
  );

  // En production, le frontend est servi par le meme hostname que l'API :
  // l'origine est identique, donc AUCUN CORS n'est necessaire. CORS n'existe
  // qu'en developpement, ou Vite tourne sur un port distinct.
  if (config.get('NODE_ENV', { infer: true }) !== 'production') {
    app.enableCors({ origin: config.get('PUBLIC_BASE_URL', { infer: true }), credentials: true });
  }

  const swagger = new DocumentBuilder()
    .setTitle('Portail de Depot de Pieces')
    .setDescription('API — espace avocat authentifie et parcours de depot client anonyme')
    .setVersion('1.0')
    .build();
  SwaggerModule.setup('api/docs', app, SwaggerModule.createDocument(app, swagger));

  const port = config.get('PORT_BACKEND', { infer: true });
  const bindAddress = config.get('BIND_ADDRESS', { infer: true });

  // En developpement : 127.0.0.1, car le serveur est partage avec d'autres
  // candidats et le process tourne sur l'hote.
  // En conteneur : 0.0.0.0, faute de quoi nginx ne peut pas joindre le service.
  // Le port n'etant pas publie sur l'hote, l'exposition reste nulle.
  await app.listen(port, bindAddress);

  new Logger('Bootstrap').log(`API sur http://${bindAddress}:${port}/api — docs /api/docs`);
}

void bootstrap();
