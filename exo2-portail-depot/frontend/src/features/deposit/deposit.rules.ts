/**
 * Regles de recevabilite cote client.
 *
 * Elles dupliquent celles du serveur (`document-rules.ts`) a dessein : ici, le
 * but est de dire NON immediatement, avant de consommer la bande passante d un
 * client sur un fichier qui sera refuse. La regle qui compte reste celle du
 * serveur — si les deux divergent, c est lui qui a raison.
 */

export const MAX_FILE_BYTES = 25 * 1024 * 1024;
export const MAX_FILES = 10;

/** Doit rester aligne sur ALLOWED_TYPES du backend. */
const ALLOWED_MIME_TYPES = new Set([
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/tiff',
  'text/plain',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.oasis.opendocument.text',
  'application/vnd.oasis.opendocument.spreadsheet',
]);

/** Attribut accept de l input, derive de la meme liste. */
export const ACCEPT_ATTRIBUTE =
  '.pdf,.jpg,.jpeg,.png,.webp,.tif,.tiff,.txt,.doc,.docx,.xls,.xlsx,.odt,.ods';

/** Renvoie un message d erreur lisible, ou null si le fichier est acceptable. */
export function checkFile(file: File): string | null {
  if (file.size === 0) {
    return 'Ce fichier est vide.';
  }
  if (file.size > MAX_FILE_BYTES) {
    return `Ce fichier depasse ${Math.floor(MAX_FILE_BYTES / 1024 / 1024)} Mo.`;
  }
  // Un navigateur peut ne pas deviner le type ; on laisse alors le serveur
  // trancher plutot que de refuser un depot legitime.
  if (file.type && !ALLOWED_MIME_TYPES.has(file.type)) {
    return 'Ce format de fichier n est pas accepte.';
  }
  return null;
}

export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} o`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} Ko`;
  return `${(bytes / 1024 / 1024).toFixed(1)} Mo`;
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
