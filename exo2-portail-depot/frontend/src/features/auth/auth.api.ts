import { api } from '../../lib/api';

/**
 * Appels d authentification.
 *
 * Aucun composant n appelle axios directement : les URLs et la forme des
 * reponses vivent ici, ce qui permet de les changer sans toucher a l interface.
 *
 * Le jeton n apparait nulle part dans ce fichier. Il est pose par le serveur
 * dans un cookie HttpOnly : le frontend ne peut ni le lire, ni le stocker, ni
 * le perdre.
 */

export interface Lawyer {
  id: string;
  email: string;
  displayName: string;
  createdAt: string;
}

export interface Credentials {
  email: string;
  password: string;
}

export async function login(credentials: Credentials): Promise<void> {
  await api.post('/auth/login', credentials);
}

export async function logout(): Promise<void> {
  await api.post('/auth/logout');
}

/**
 * Profil de l avocat connecte.
 *
 * C est la seule facon de savoir si une session est ouverte : on interroge le
 * serveur. Un 401 signifie simplement « pas connecte », ce n est pas une erreur
 * a afficher.
 */
export async function fetchCurrentLawyer(): Promise<Lawyer> {
  const { data } = await api.get<Lawyer>('/auth/me');
  return data;
}
