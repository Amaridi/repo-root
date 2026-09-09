import { AxiosError } from 'axios';

/**
 * Traduction des erreurs de l API en messages destines au client.
 *
 * Le vocabulaire est volontairement sobre et sans jargon : la personne en face
 * n est pas informaticienne, elle transmet des pieces a son avocat. Aucun detail
 * technique n est expose — cela ne l aiderait pas, et cela renseignerait un
 * attaquant.
 */

export interface DepositErrorInfo {
  message: string;
  attemptsLeft?: number;
  retryAfterSeconds?: number;
  /** true quand le lien est definitivement inutilisable. */
  isUnavailable: boolean;
}

interface ApiErrorBody {
  message?: string | string[];
  attemptsLeft?: number;
  retryAfterSeconds?: number;
}

export function describeDepositError(error: unknown): DepositErrorInfo {
  if (!(error instanceof AxiosError)) {
    return { message: 'Une erreur inattendue est survenue.', isUnavailable: false };
  }

  const status = error.response?.status;
  const body = (error.response?.data ?? {}) as ApiErrorBody;

  if (status === 404) {
    // Le serveur repond 404 de facon uniforme : lien inconnu, expire, deja
    // soumis ou cloture. On ne peut donc pas etre plus precis — et c est
    // exactement l objectif.
    return {
      message:
        'Ce lien n est plus utilisable. Il a peut-etre expire, ou le depot a deja ete transmis. Contactez votre avocat.',
      isUnavailable: true,
    };
  }

  if (status === 403) {
    const seconds = body.retryAfterSeconds ?? 900;
    return {
      message: `Trop de tentatives. Nouvel essai possible dans ${Math.ceil(seconds / 60)} minutes.`,
      retryAfterSeconds: seconds,
      isUnavailable: false,
    };
  }

  if (status === 401) {
    return {
      message: 'Code incorrect.',
      attemptsLeft: body.attemptsLeft,
      isUnavailable: false,
    };
  }

  if (status === 400) {
    const raw = body.message;
    return {
      message: Array.isArray(raw) ? raw[0] : (raw ?? 'Demande invalide.'),
      isUnavailable: false,
    };
  }

  if (status === 409) {
    return {
      message: Array.isArray(body.message)
        ? body.message[0]
        : (body.message ?? 'Nombre maximal de documents atteint.'),
      isUnavailable: false,
    };
  }

  return { message: 'Le service est momentanement indisponible.', isUnavailable: false };
}
