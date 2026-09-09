import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { DepositAccessModule } from '../deposit-access/deposit-access.module';
import { DepositDocumentsController } from './deposit-documents.controller';
import { DocumentsService } from './documents.service';
import { LawyerDocumentsController } from './lawyer-documents.controller';

/**
 * Deux controleurs, un seul service.
 *
 * C est le seul module qui touche aux deux univers d authentification, parce
 * que le meme objet metier est vu par les deux acteurs. Les surfaces restent
 * separees : le client depose et ne voit que sa demande, l avocat consulte et
 * telecharge ses propres demandes. Aucune route ne sert les deux.
 *
 * StorageModule est global, il n a pas a etre importe ici.
 */
@Module({
  imports: [AuthModule, DepositAccessModule],
  controllers: [DepositDocumentsController, LawyerDocumentsController],
  providers: [DocumentsService],
  exports: [DocumentsService],
})
export class DocumentsModule {}
