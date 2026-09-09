import type { Request } from 'express';
import { LAWYER_TOKEN_AUDIENCE } from './auth.constants';

/**
 * Claims que l'application place elle-meme dans le token.
 *
 * Volontairement minimal, et SANS aud : l'audience est une claim standard,
 * posee par la bibliotheque via signOptions (voir AuthModule). La declarer
 * aussi dans le payload provoque une erreur de signature
 * ("The payload already has an aud property").
 */
export interface LawyerJwtClaims {
  sub: string;
  email: string;
}

/** Token decode : les claims applicatifs, plus celles posees par la bibliotheque. */
export interface LawyerJwtPayload extends LawyerJwtClaims {
  aud: typeof LAWYER_TOKEN_AUDIENCE;
  iat: number;
  exp: number;
}

/** Identite injectee dans la requete par JwtAuthGuard. */
export interface AuthenticatedLawyer {
  id: string;
  email: string;
}

/**
 * Requete dont l'authentification a ete validee par JwtAuthGuard.
 * Le champ est optionnel au niveau du type car Express ne le connait pas ;
 * il est garanti present dans tout handler protege par la garde.
 */
export interface AuthenticatedRequest extends Request {
  lawyer?: AuthenticatedLawyer;
}
