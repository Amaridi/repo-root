/**
 * Noms des metriques, en un seul endroit.
 *
 * Une metrique est un CONTRAT : son nom apparait dans les regles d alerte
 * Prometheus et dans le dashboard Grafana, qui vivent hors de ce depot au
 * moment du deploiement. La renommer casse silencieusement une alerte, ce qui
 * est la pire panne possible pour de l observabilite. D ou la centralisation.
 *
 * Convention Prometheus respectee : suffixe _total pour un compteur, unite en
 * suffixe pour un histogramme (_seconds), pas de majuscules.
 */
export const METRIC = {
  HTTP_REQUESTS: 'http_requests_total',
  HTTP_DURATION: 'http_request_duration_seconds',
  DEPOSIT_REQUESTS_CREATED: 'deposit_requests_created_total',
  DEPOSIT_SUBMISSIONS: 'deposit_submissions_total',
  PIN_VERIFICATIONS: 'deposit_pin_verifications_total',
  DOCUMENT_UPLOADS: 'document_uploads_total',
} as const;

/**
 * Issues d une verification de PIN. Trois valeurs, fermees : le label ne peut
 * pas exploser en cardinalite.
 */
export type PinOutcome = 'success' | 'invalid' | 'locked';

/**
 * Issues de la confirmation d un depot de fichier.
 * `rejected` = l objet etait bien dans MinIO mais sa taille ou son type reels
 * ne correspondaient pas a ce qui avait ete annonce ; il a ete supprime.
 * `failed`   = l objet est introuvable ou le stockage a repondu en erreur.
 */
export type UploadOutcome = 'confirmed' | 'rejected' | 'failed';
