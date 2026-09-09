/**
 * Cookie de session de depot, cote client anonyme.
 * Distinct du cookie avocat : les deux peuvent coexister dans un meme
 * navigateur sans jamais se confondre.
 */
export const DEPOSIT_SESSION_COOKIE = 'deposit_session';

/**
 * Audience du token de session de depot.
 *
 * Seconde barriere apres la separation des cles de signature : meme en cas
 * d'erreur de configuration ou de reutilisation accidentelle d'un secret, un
 * token 'deposit' est rejete par la garde avocat et reciproquement.
 */
export const DEPOSIT_TOKEN_AUDIENCE = 'deposit';

/**
 * Forme attendue du token public : 43 caracteres base64url (32 octets).
 * Filtrer en amont evite d'interroger la base avec une entree arbitraire.
 */
export const ACCESS_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;
