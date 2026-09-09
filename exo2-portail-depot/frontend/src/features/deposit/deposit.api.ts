import axios from 'axios';
import { api } from '../../lib/api';

/**
 * Appels du parcours client anonyme.
 *
 * Tout passe par /api/public/*. Aucune fonction de ce fichier n atteint une
 * route avocat, et aucune ne manipule d identifiant de stockage : le navigateur
 * ne recoit que des URLs deja signees par le serveur, valables quelques
 * minutes et portant sur un seul objet.
 */

export interface PublicDeposit {
  title: string;
  instructions: string | null;
  lawyerName: string;
  clientName: string;
  expiresAt: string;
}

export interface DepositSession extends PublicDeposit {
  status: string;
  documentsCount: number;
  sessionExpiresAt: string;
}

export interface DepositDocument {
  id: string;
  originalName: string;
  mimeType: string;
  sizeBytes: number;
  status: 'PENDING' | 'AVAILABLE';
  confirmedAt: string | null;
  createdAt: string;
}

interface UploadTicket {
  documentId: string;
  uploadUrl: string;
  requiredHeaders: Record<string, string>;
  expiresAt: string;
}

/** Metadonnees d affichage, avant saisie du code. */
export async function resolveDeposit(token: string): Promise<PublicDeposit> {
  const { data } = await api.get<PublicDeposit>(`/public/deposits/${token}`);
  return data;
}

/**
 * Validation du code.
 *
 * La session part dans un cookie HttpOnly pose par le serveur : ce code n a
 * donc rien a stocker, et le PIN n est jamais conserve en memoire au-dela de
 * cet appel.
 */
export async function verifyPin(token: string, pin: string): Promise<void> {
  await api.post(`/public/deposits/${token}/verify-pin`, { pin });
}

export async function fetchDepositSession(): Promise<DepositSession> {
  const { data } = await api.get<DepositSession>('/public/deposits/session/me');
  return data;
}

export async function fetchDepositDocuments(): Promise<DepositDocument[]> {
  const { data } = await api.get<DepositDocument[]>('/public/deposits/session/documents');
  return data;
}

export async function submitDeposit(): Promise<{ submittedAt: string; documentsCount: number }> {
  const { data } = await api.post<{ submittedAt: string; documentsCount: number }>(
    '/public/deposits/session/submit',
  );
  return data;
}

export async function closeDepositSession(): Promise<void> {
  await api.post('/public/deposits/session/logout');
}

/**
 * Depot d un fichier, en trois temps.
 *
 * 1. Le serveur autorise et signe. Il ne recoit que des metadonnees.
 * 2. Le NAVIGATEUR envoie les octets DIRECTEMENT au stockage. Ils ne passent
 *    jamais par l API : c est ce qui garantit qu aucun fichier ne peut atterrir
 *    sur le disque du backend.
 * 3. Le serveur confirme apres avoir verifie la taille et le type reels.
 *
 * Le PUT utilise `axios` nu et NON le client `api` : celui-ci envoie les
 * cookies (`withCredentials`) et prefixe /api. Envoyer un cookie de session a
 * un service de stockage tiers serait une fuite inutile, et la signature ne
 * couvre pas ces en-tetes.
 */
export async function uploadDocument(
  file: File,
  onProgress: (percent: number) => void,
): Promise<DepositDocument> {
  const { data: ticket } = await api.post<UploadTicket>('/public/deposits/session/documents', {
    filename: file.name,
    mimeType: file.type,
    sizeBytes: file.size,
  });

  await axios.put(ticket.uploadUrl, file, {
    headers: ticket.requiredHeaders,
    withCredentials: false,
    onUploadProgress: (event) => {
      if (event.total) {
        onProgress(Math.round((event.loaded / event.total) * 100));
      }
    },
  });

  const { data: confirmed } = await api.post<DepositDocument>(
    `/public/deposits/session/documents/${ticket.documentId}/confirm`,
  );

  return confirmed;
}
