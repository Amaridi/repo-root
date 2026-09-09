import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import type { Env } from '../config/env.validation';
import { DepositAccessController } from './deposit-access.controller';
import { DepositAccessService } from './deposit-access.service';
import { DEPOSIT_TOKEN_AUDIENCE } from './deposit-access.constants';
import { DepositSessionGuard } from './guards/deposit-session.guard';

/**
 * Ce module n importe PAS AuthModule.
 *
 * Il enregistre sa propre instance de JwtModule, configuree avec
 * JWT_DEPOSIT_SECRET et l audience deposit. La consequence est structurelle :
 * aucun code de ce module ne dispose de la cle avocat, et aucun code du module
 * avocat ne dispose de celle-ci. La separation des deux univers de jetons n est
 * pas une convention, c est une propriete du graphe de dependances.
 */
@Module({
  imports: [
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) => ({
        secret: config.get('JWT_DEPOSIT_SECRET', { infer: true }),
        signOptions: {
          expiresIn: config.get('JWT_DEPOSIT_TTL', { infer: true }),
          audience: DEPOSIT_TOKEN_AUDIENCE,
        },
      }),
    }),
  ],
  controllers: [DepositAccessController],
  providers: [DepositAccessService, DepositSessionGuard],
  // Exportes pour le module de gestion des documents (bloc 6), qui devra
  // proteger ses routes d upload avec la meme garde et reverifier l etat de la
  // demande via assertOpenForDeposit.
  exports: [DepositAccessService, DepositSessionGuard, JwtModule],
})
export class DepositAccessModule {}
