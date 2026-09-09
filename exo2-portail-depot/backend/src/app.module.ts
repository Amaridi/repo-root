import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { validateEnv } from './config/env.validation';
import { PrismaModule } from './prisma/prisma.module';
import { HealthModule } from './health/health.module';
import { AuthModule } from './auth/auth.module';
import { DepositModule } from './deposit/deposit.module';
import { DepositAccessModule } from './deposit-access/deposit-access.module';
import { StorageModule } from './storage/storage.module';
import { DocumentsModule } from './documents/documents.module';
import { MetricsModule } from './metrics/metrics.module';

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
    // Transversal et global : expose /api/metrics et fournit MetricsService a
    // tous les modules metier sans qu ils aient a l importer.
    MetricsModule,
    HealthModule,
    AuthModule,
    DepositModule,
    DepositAccessModule,
    StorageModule,
    DocumentsModule,
  ],
})
export class AppModule {}
