import { createHash, randomBytes, randomInt } from 'node:crypto';

/**
 * Generation et hachage des secrets d'acces a une demande de depot.
 *
 * Fonctions pures, sans dependance a Nest ni a Prisma : elles sont donc
 * directement testables unitairement (bloc 8), et le meme code servira a la
 * verification cote parcours client (bloc 4).
 */

/** Longueur du token du lien public, en octets. 32 octets = 256 bits. */
const ACCESS_TOKEN_BYTES = 32;

/** Nombre de chiffres du PIN remis au client. */
const PIN_DIGITS = 6;

/**
 * Token du lien public.
 *
 * 256 bits d'entropie, en base64url pour rester utilisable tel quel dans une
 * URL. A cette entropie, l'enumeration est hors de portee : c'est ce qui permet
 * de traiter le lien comme un premier facteur.
 */
export function generateAccessToken(): string {
  return randomBytes(ACCESS_TOKEN_BYTES).toString('base64url');
}

/**
 * Empreinte du token, telle que stockee en base.
 *
 * SHA-256 et non argon2 : le token n'est pas brute-forcable (256 bits), et il
 * doit rester consultable en temps constant a chaque requete publique. Le PIN,
 * lui, ne vaut que 10^6 combinaisons et exige un hachage lent (argon2id).
 */
export function hashAccessToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/**
 * PIN a 6 chiffres, zeros de tete conserves.
 *
 * randomInt du module crypto et non Math.random : la source est
 * cryptographiquement sure et la distribution uniforme (pas de biais modulo).
 */
export function generatePin(): string {
  const max = 10 ** PIN_DIGITS;
  return randomInt(0, max).toString().padStart(PIN_DIGITS, '0');
}

/** URL publique remise au client. */
export function buildDepositUrl(baseUrl: string, token: string): string {
  return `${baseUrl.replace(/\/+$/, '')}/d/${token}`;
}
