import {
  createParamDecorator,
  ExecutionContext,
  InternalServerErrorException,
} from '@nestjs/common';
import type { AuthenticatedLawyer, AuthenticatedRequest } from '../auth.types';

/**
 * Injecte l'avocat authentifie dans un handler :
 *
 *     @Get() findAll(@CurrentLawyer() lawyer: AuthenticatedLawyer) { ... }
 *
 * Le seul decorateur maison du projet. Il evite que chaque controleur
 * manipule request.lawyer, et rend impossible d'oublier le filtre par
 * proprietaire dans les modules a venir.
 */
export const CurrentLawyer = createParamDecorator(
  (_data: unknown, context: ExecutionContext): AuthenticatedLawyer => {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();

    if (!request.lawyer) {
      // Signifie que le decorateur est utilise sur une route non protegee par
      // JwtAuthGuard : c'est une erreur de programmation, pas une erreur
      // d'authentification.
      throw new InternalServerErrorException(
        'CurrentLawyer utilise sans JwtAuthGuard sur la route.',
      );
    }

    return request.lawyer;
  },
);
