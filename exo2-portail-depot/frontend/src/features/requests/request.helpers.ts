import type { DepositRequest } from './requests.api';

/**
 * Helpers de presentation, sans dependance a React : testables tels quels.
 */

/**
 * Statut affiche.
 *
 * L expiration n est PAS un statut persiste cote serveur, c est une comparaison
 * de dates. Elle est donc fusionnee ici, a l affichage — et elle prime sur
 * PENDING ou IN_PROGRESS, car un lien expire ne peut plus rien recevoir. Une
 * demande soumise ou cloturee garde en revanche son statut : ce sont des actes
 * metier, et ils ont eu lieu avant l echeance.
 */
export function statusOf(
  request: Pick<DepositRequest, 'status' | 'isExpired'>,
): 'PENDING' | 'IN_PROGRESS' | 'SUBMITTED' | 'CLOSED' | 'EXPIRED' {
  if (request.status === 'SUBMITTED' || request.status === 'CLOSED') {
    return request.status;
  }
  return request.isExpired ? 'EXPIRED' : request.status;
}

export function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('fr-FR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
}

export function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString('fr-FR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/** Taille lisible. Les octets bruts ne disent rien a un lecteur humain. */
export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} o`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} Ko`;
  return `${(bytes / 1024 / 1024).toFixed(1)} Mo`;
}
