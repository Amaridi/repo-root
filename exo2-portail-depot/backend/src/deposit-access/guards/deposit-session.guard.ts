import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import type { Env } from '../../config/env.validation';
import { DEPOSIT_SESSION_COOKIE, DEPOSIT_TOKEN_AUDIENCE } from '../deposit-access.constants';
import type { DepositJwtPayload, DepositSessionRequest } from '../deposit-access.types';

/**
 * Protege les routes accessibles apres validation du PIN.
 *
 * Symetrique de JwtAuthGuard, avec deux differences essentielles :
 *  - une CLE de signature distincte (JWT_DEPOSIT_SECRET) ;
 *  - une AUDIENCE distincte (deposit).
 *
 * Les deux barrieres sont redondantes a dessein. La cle seule suffirait, mais
 * l audience protege le jour ou une erreur de configuration ferait pointer les
 * deux secrets sur la meme valeur : un token client resterait alors refuse par
 * la garde avocat, et reciproquement.
 *
 * Cette garde n atteste QUE de la session. La demande peut avoir expire depuis
 * son emission, ce que le service reverifie systematiquement.
 */
@Injectable()
export class DepositSessionGuard implements CanActivate {
  constructor(
    private readonly jwt: JwtService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<DepositSessionRequest>();
    const token: unknown = request.cookies?.[DEPOSIT_SESSION_COOKIE];

    if (typeof token !== 'string' || token.length === 0) {
      throw new UnauthorizedException('Code non valide ou session expiree.');
    }

    let payload: DepositJwtPayload;
    try {
      payload = await this.jwt.verifyAsync<DepositJwtPayload>(token, {
        secret: this.config.get('JWT_DEPOSIT_SECRET', { infer: true }),
        audience: DEPOSIT_TOKEN_AUDIENCE,
      });
    } catch {
      throw new UnauthorizedException('Code non valide ou session expiree.');
    }

    if (payload.scope !== 'deposit') {
      throw new UnauthorizedException('Code non valide ou session expiree.');
    }

    // L expiration est exposee au handler pour l afficher au client sans
    // qu il ait a decoder quoi que ce soit.
    request.depositSession = {
      requestId: payload.sub,
      expiresAt: new Date(payload.exp * 1000),
    };
    return true;
  }
}
