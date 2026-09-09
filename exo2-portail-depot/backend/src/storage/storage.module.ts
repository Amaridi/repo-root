import { Global, Module } from '@nestjs/common';
import { StorageService } from './storage.service';

/**
 * Global : la sonde de sante et la gestion des documents en ont besoin, et il
 * n y a aucune raison de reconstruire deux clients S3.
 */
@Global()
@Module({
  providers: [StorageService],
  exports: [StorageService],
})
export class StorageModule {}
