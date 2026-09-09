import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { validateEnv } from './config/env.validation';
import { PrismaModule } from './prisma/prisma.module';
import { HealthModule } from './health/health.module';
import { AuthModule } from './auth/auth.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      // Un seul .env, a la racine du depot : c'est aussi celui que lisent
      // docker compose et install.sh. Une seule source de verite.
      envFilePath: ['../.env', '.env'],
      validate: validateEnv,
    }),
    PrismaModule,
    HealthModule,
    AuthModule,
    // Bloc 3 : DepositRequestsModule
    // Bloc 4 : DepositAccessModule
    // Bloc 6 : StorageModule, DocumentsModule
    // Bloc 9 : MetricsModule
  ],
})
export class AppModule {}
