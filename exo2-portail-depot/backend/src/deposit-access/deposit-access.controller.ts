import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { CookieOptions, Response } from 'express';
import type { Env } from '../config/env.validation';
import { DepositAccessService } from './deposit-access.service';
import { DEPOSIT_SESSION_COOKIE } from './deposit-access.constants';
import type { DepositSession } from './deposit-access.types';
import { CurrentDeposit } from './decorators/current-deposit.decorator';
import { DepositSessionGuard } from './guards/deposit-session.guard';
import { DepositSessionView, PublicDepositView } from './dto/public-deposit.view';
import { VerifyPinDto } from './dto/verify-pin.dto';

/**
 * Surface PUBLIQUE : aucune de ces routes ne demande de compte.
 *
 * Le token du lien est le seul designateur accepte. Aucun endpoint de ce
 * controleur n accepte un identifiant de demande : l identifiant Prisma
 * n ouvre donc aucun acces, meme s il etait connu.
 */
@ApiTags('public')
@Controller('public/deposits')
export class DepositAccessController {
  constructor(
    private readonly accessService: DepositAccessService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  @Get(':token')
  @ApiOperation({ summary: 'Metadonnees de la demande, avant saisie du PIN' })
  @ApiResponse({ status: 200, type: PublicDepositView })
  @ApiResponse({
    status: 404,
    description: 'Token inconnu, malforme, expire, deja soumis ou cloture — reponse identique',
  })
  resolve(@Param('token') token: string): Promise<PublicDepositView> {
    return this.accessService.resolve(token);
  }

  @Post(':token/verify-pin')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Valider le PIN et ouvrir une session de depot' })
  @ApiResponse({ status: 200, description: 'Session ouverte, cookie pose' })
  @ApiResponse({ status: 401, description: 'Code invalide (attemptsLeft indique)' })
  @ApiResponse({ status: 403, description: 'Trop de tentatives, acces temporairement bloque' })
  @ApiResponse({ status: 404, description: 'Demande indisponible' })
  async verifyPin(
    @Param('token') token: string,
    @Body() dto: VerifyPinDto,
    @Res({ passthrough: true }) response: Response,
  ) {
    const result = await this.accessService.verifyPin(token, dto.pin);

    // La session part en cookie HttpOnly : le PIN n est saisi qu une fois, et
    // le navigateur n a jamais a le conserver pour les requetes suivantes.
    response.cookie(DEPOSIT_SESSION_COOKIE, result.token, {
      ...this.cookieOptions(),
      expires: result.expiresAt,
    });

    return { deposit: result.deposit, sessionExpiresAt: result.expiresAt };
  }

  @Get('session/me')
  @UseGuards(DepositSessionGuard)
  @ApiOperation({ summary: 'Etat de la demande pour une session ouverte' })
  @ApiResponse({ status: 200, type: DepositSessionView })
  @ApiResponse({ status: 401, description: 'Session absente, invalide ou expiree' })
  @ApiResponse({ status: 404, description: 'Demande expiree ou cloturee depuis l ouverture' })
  getSession(@CurrentDeposit() session: DepositSession): Promise<DepositSessionView> {
    return this.accessService.getSessionDeposit(session.requestId, session.expiresAt);
  }

  @Post('session/submit')
  @UseGuards(DepositSessionGuard)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Soumettre definitivement le depot ; ferme le lien public' })
  @ApiResponse({ status: 200, description: 'Demande soumise' })
  @ApiResponse({ status: 400, description: 'Aucun document disponible' })
  @ApiResponse({ status: 401, description: 'Session absente, invalide ou expiree' })
  @ApiResponse({ status: 404, description: 'Demande expiree, deja soumise ou cloturee' })
  submit(@CurrentDeposit() session: DepositSession) {
    return this.accessService.submit(session.requestId);
  }
  @Post('session/logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Fermer la session de depot' })
  closeSession(@Res({ passthrough: true }) response: Response): void {
    response.clearCookie(DEPOSIT_SESSION_COOKIE, this.cookieOptions());
  }

  private cookieOptions(): CookieOptions {
    return {
      httpOnly: true,
      secure: this.config.get('COOKIE_SECURE', { infer: true }),
      sameSite: 'strict',
      path: '/',
    };
  }
}
