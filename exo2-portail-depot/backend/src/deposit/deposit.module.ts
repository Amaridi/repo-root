import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { DepositController } from './deposit.controller';
import { DepositService } from './deposit.service';

@Module({
  // AuthModule fournit JwtAuthGuard et la configuration JWT : la protection
  // des routes ne redeclare aucun secret.
  imports: [AuthModule],
  controllers: [DepositController],
  providers: [DepositService],
  // Exporte pour le parcours client anonyme et la gestion des documents.
  exports: [DepositService],
})
export class DepositModule {}
