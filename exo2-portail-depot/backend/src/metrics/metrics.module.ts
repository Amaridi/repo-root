import { Global, Module } from '@nestjs/common';
import { MetricsController } from './metrics.controller';
import { MetricsService } from './metrics.service';

/**
 * Observabilite.
 *
 * `@Global()` est un choix assume : l instrumentation est une preoccupation
 * transversale, exactement comme la configuration. L alternative — importer
 * MetricsModule dans chacun des modules metier — ajoute une ligne de couplage
 * par module pour aucun gain de lisibilite.
 */
@Global()
@Module({
  controllers: [MetricsController],
  providers: [MetricsService],
  exports: [MetricsService],
})
export class MetricsModule {}
