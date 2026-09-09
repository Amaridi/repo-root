import { randomUUID } from 'node:crypto';

/**
 * Regles de recevabilite d un fichier, et fabrication des cles de stockage.
 *
 * Fonctions pures : testables unitairement sans MinIO ni base de donnees.
 */

/**
 * Types acceptes, en LISTE BLANCHE.
 *
 * Une liste noire serait toujours en retard d un format dangereux. Ici seuls
 * les formats attendus dans un dossier juridique passent : pieces scannees,
 * photos, documents bureautiques, texte simple.
 *
 * L extension est verifiee EN PLUS du type MIME : les deux sont declares par le
 * client, mais exiger leur coherence supprime le cas ou un executable est
 * annonce comme PDF.
 */
export const ALLOWED_TYPES: Record<string, readonly string[]> = {
  'application/pdf': ['pdf'],
  'image/jpeg': ['jpg', 'jpeg'],
  'image/png': ['png'],
  'image/webp': ['webp'],
  'image/tiff': ['tif', 'tiff'],
  'text/plain': ['txt'],
  'application/msword': ['doc'],
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': ['docx'],
  'application/vnd.ms-excel': ['xls'],
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ['xlsx'],
  'application/vnd.oasis.opendocument.text': ['odt'],
  'application/vnd.oasis.opendocument.spreadsheet': ['ods'],
};

export type FileRejection =
  | { reason: 'MIME_NOT_ALLOWED'; detail: string }
  | { reason: 'EXTENSION_MISMATCH'; detail: string }
  | { reason: 'TOO_LARGE'; detail: string }
  | { reason: 'EMPTY'; detail: string };

/** Extension en minuscules, sans le point. Chaine vide si absente. */
export function extensionOf(filename: string): string {
  const lastDot = filename.lastIndexOf('.');
  if (lastDot <= 0 || lastDot === filename.length - 1) return '';
  return filename.slice(lastDot + 1).toLowerCase();
}

/**
 * Verifie la recevabilite declaree. Renvoie null si le fichier est acceptable.
 *
 * Ces controles portent sur ce que le client ANNONCE. La taille reelle est
 * reverifiee cote stockage a la confirmation : c est la seule valeur digne de
 * confiance.
 */
export function validateDeclaredFile(
  filename: string,
  mimeType: string,
  sizeBytes: number,
  maxBytes: number,
): FileRejection | null {
  // Object.hasOwn et non un simple acces indexe : sur un objet litteral, la
  // recherche par cle traverse aussi la CHAINE DE PROTOTYPES. Un type annonce
  // 'constructor', 'toString' ou '__proto__' — valeurs entierement controlees
  // par le client — renvoyait alors une fonction au lieu de undefined, le garde
  // ci-dessous ne declenchait pas, et le .includes() suivant levait une
  // TypeError : une reponse 500 la ou un 400 etait attendu.
  const allowedExtensions = Object.hasOwn(ALLOWED_TYPES, mimeType)
    ? ALLOWED_TYPES[mimeType]
    : undefined;

  if (!allowedExtensions) {
    return { reason: 'MIME_NOT_ALLOWED', detail: `Type de fichier non autorise : ${mimeType}.` };
  }

  const extension = extensionOf(filename);
  if (!allowedExtensions.includes(extension)) {
    return {
      reason: 'EXTENSION_MISMATCH',
      detail: `L extension .${extension || '(absente)'} ne correspond pas au type ${mimeType}.`,
    };
  }

  if (sizeBytes <= 0) {
    return { reason: 'EMPTY', detail: 'Le fichier est vide.' };
  }

  if (sizeBytes > maxBytes) {
    return {
      reason: 'TOO_LARGE',
      detail: `Le fichier depasse la taille maximale de ${Math.floor(maxBytes / 1024 / 1024)} Mo.`,
    };
  }

  return null;
}

/**
 * Nom de fichier reduit a une forme sure pour une cle de stockage.
 *
 * Le nom fourni par le client n est JAMAIS utilise tel quel comme cle :
 * traversee de chemin (../), collisions, unicode, longueur. Le nom d origine
 * est conserve en base pour l affichage et reinjecte au telechargement.
 */
export function slugifyFilename(filename: string): string {
  const extension = extensionOf(filename);
  const base = extension ? filename.slice(0, -(extension.length + 1)) : filename;

  const slug = base
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // accents combinatoires
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase()
    .slice(0, 80);

  const safeBase = slug || 'document';
  return extension ? `${safeBase}.${extension}` : safeBase;
}

/**
 * Cle d objet unique : deposits/{requestId}/{documentId}/{nom-normalise}
 *
 * L identifiant du document garantit l unicite meme si le client depose deux
 * fois le meme nom, et le prefixe par demande rend le tri et la suppression en
 * cascade triviaux cote stockage.
 */
export function buildStorageKey(
  requestId: string,
  originalName: string,
): {
  documentId: string;
  storageKey: string;
} {
  const documentId = randomUUID();
  return {
    documentId,
    storageKey: `deposits/${requestId}/${documentId}/${slugifyFilename(originalName)}`,
  };
}
