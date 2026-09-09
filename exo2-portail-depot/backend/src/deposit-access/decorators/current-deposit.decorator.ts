import {
  createParamDecorator,
  ExecutionContext,
  InternalServerErrorException,
} from '@nestjs/common';
import type { DepositSession, DepositSessionRequest } from '../deposit-access.types';

/**
 * Injecte la session de depot validee :
 *
 *     @Get() read(@CurrentDeposit() session: DepositSession) { ... }
 *
 * Le handler ne peut donc travailler que sur la demande designee par la
 * session — il n a aucun moyen de recevoir un identifiant de demande depuis le
 * client.
 */
export const CurrentDeposit = createParamDecorator(
  (_data: unknown, context: ExecutionContext): DepositSession => {
    const request = context.switchToHttp().getRequest<DepositSessionRequest>();

    if (!request.depositSession) {
      // Decorateur utilise sur une route non protegee par DepositSessionGuard :
      // erreur de programmation, pas erreur d authentification.
      throw new InternalServerErrorException(
        'CurrentDeposit utilise sans DepositSessionGuard sur la route.',
      );
    }

    return request.depositSession;
  },
);
