/**
 * Nom du cookie de session avocat.
 *
 * Le JWT vit dans un cookie HttpOnly et non dans localStorage : il est donc
 * inaccessible au JavaScript, y compris a une XSS. Le frontend ne le lit
 * jamais — il interroge /api/auth/me pour savoir s'il est connecte.
 */
export const LAWYER_SESSION_COOKIE = 'depot_session';

/**
 * Audience du token avocat.
 *
 * L'application emettra plus tard un second type de token (session de depot
 * client, bloc 4), signe avec une AUTRE cle. L'audience est une seconde
 * barriere : meme en cas d'erreur de configuration des cles, un token de depot
 * ne peut pas etre presente comme un token avocat.
 */
export const LAWYER_TOKEN_AUDIENCE = 'lawyer';
