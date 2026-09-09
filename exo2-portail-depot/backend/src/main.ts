import { ValidationPipe, Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import cookieParser from 'cookie-parser';
import { AppModule } from './app.module';
import type { Env } from './config/env.validation';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  const config = app.get(ConfigService<Env, true>);

  // Tout est prefixe /api : en production, nginx route /api/* vers ce service
  // et / vers le frontend, sur un hostname unique.
  app.setGlobalPrefix('api');

  app.use(cookieParser());

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
  // Ecoute sur 127.0.0.1 uniquement : le serveur est partage avec d'autres
  // candidats, seul le proxy frontal doit pouvoir joindre ce service.
  await app.listen(port, '127.0.0.1');

  new Logger('Bootstrap').log(`API sur http://127.0.0.1:${port}/api — docs /api/docs`);
}

void bootstrap();
