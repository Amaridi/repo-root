import type { Request } from 'express';
import { DEPOSIT_TOKEN_AUDIENCE } from './deposit-access.constants';

/** Claims posees par l'application dans le token de session de depot. */
export interface DepositJwtClaims {
  /** Identifiant de la demande. Le token n'ouvre l'acces qu'a celle-ci. */
  sub: string;
  /** Portee explicite : ce token autorise le depot, rien d'autre. */
  scope: 'deposit';
}

/** Token de session decode. */
export interface DepositJwtPayload extends DepositJwtClaims {
  aud: typeof DEPOSIT_TOKEN_AUDIENCE;
  iat: number;
  exp: number;
}

/** Session injectee dans la requete par DepositSessionGuard. */
export interface DepositSession {
  requestId: string;
  /** Fin de validite de la session, exposee au handler pour affichage. */
  expiresAt: Date;
}

export interface DepositSessionRequest extends Request {
  depositSession?: DepositSession;
}
