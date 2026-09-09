import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import type { Env } from '../../config/env.validation';
import { LAWYER_SESSION_COOKIE, LAWYER_TOKEN_AUDIENCE } from '../auth.constants';
import type { AuthenticatedRequest, LawyerJwtPayload } from '../auth.types';

/**
 * Protege les routes reservees a l'avocat.
 *
 * A appliquer avec @UseGuards(JwtAuthGuard) sur un controleur entier
 * (DepositRequestsModule, DocumentsModule) plutot que route par route : le
 * defaut devient "protege", et une nouvelle route n'est jamais publique par
 * oubli.
 *
 * La garde injecte l'identite dans la requete, ou @CurrentLawyer() la lit.
 * Aucun controleur ne decode donc de token lui-meme.
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly jwt: JwtService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const token: unknown = request.cookies?.[LAWYER_SESSION_COOKIE];

    if (typeof token !== 'string' || token.length === 0) {
      throw new UnauthorizedException('Authentification requise.');
    }

    let payload: LawyerJwtPayload;
    try {
      payload = await this.jwt.verifyAsync<LawyerJwtPayload>(token, {
        secret: this.config.get('JWT_LAWYER_SECRET', { infer: true }),
        // Verification explicite de l'audience : un token de session de depot
        // client, meme correctement signe avec sa propre cle, sera rejete ici.
        audience: LAWYER_TOKEN_AUDIENCE,
      });
    } catch {
      // Signature invalide, token expire ou audience incorrecte : la reponse
      // est la meme dans les trois cas.
      throw new UnauthorizedException('Session invalide ou expiree.');
    }

    request.lawyer = { id: payload.sub, email: payload.email };
    return true;
  }
}
