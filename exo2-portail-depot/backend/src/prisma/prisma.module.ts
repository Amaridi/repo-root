import { Global, Module } from '@nestjs/common';
import { PrismaService } from './prisma.service';

/**
 * Global : tous les services metier appellent Prisma directement.
 * Pas de couche repository par-dessus l'ORM — ce serait une indirection sans
 * contrepartie a cette taille de projet.
 */
@Global()
@Module({
  providers: [PrismaService],
  exports: [PrismaService],
})
export class PrismaModule {}
