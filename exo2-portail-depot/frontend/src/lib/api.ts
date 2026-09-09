import axios from 'axios';

/**
 * Un seul client HTTP.
 *
 * withCredentials : le JWT avocat vit dans un cookie HttpOnly, jamais dans
 * localStorage. Le front ne manipule donc aucun token — il ne sait meme pas
 * le lire, ce qui est precisement l'objectif face a une XSS.
 *
 * baseURL relative : en production, l'API est servie par le meme hostname que
 * le frontend (nginx route /api/*), donc aucune configuration d'URL a
 * l'execution et aucun CORS. En developpement, le proxy Vite fait la meme
 * chose vers le port du backend.
 */
export const api = axios.create({
  baseURL: '/api',
  withCredentials: true,
});
