import { api } from '../../lib/api';

/**
 * Appels de l espace avocat : demandes de depot et pieces deposees.
 */

export type DepositRequestStatus = 'PENDING' | 'IN_PROGRESS' | 'SUBMITTED' | 'CLOSED';

export interface DepositRequest {
  id: string;
  title: string;
  instructions: string | null;
  clientName: string;
  clientEmail: string | null;
  status: DepositRequestStatus;
  expiresAt: string;
  isExpired: boolean;
  submittedAt: string | null;
  createdAt: string;
  documentsCount: number;
}

export interface CreateDepositRequestInput {
  title: string;
  instructions?: string;
  clientName: string;
  clientEmail?: string;
}

/**
 * Reponse de creation : elle contient le lien et le PIN EN CLAIR.
 *
 * La base ne conserve que leurs empreintes ; ces deux valeurs sont donc
 * irrecuperables ensuite. L interface doit le dire, et ne jamais les stocker.
 */
export interface CreatedDepositRequest {
  request: DepositRequest;
  access: { depositUrl: string; pin: string };
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

export async function fetchDepositRequests(): Promise<DepositRequest[]> {
  const { data } = await api.get<DepositRequest[]>('/deposits');
  return data;
}

export async function fetchDepositRequest(id: string): Promise<DepositRequest> {
  const { data } = await api.get<DepositRequest>(`/deposits/${id}`);
  return data;
}

export async function createDepositRequest(
  input: CreateDepositRequestInput,
): Promise<CreatedDepositRequest> {
  const { data } = await api.post<CreatedDepositRequest>('/deposits', input);
  return data;
}

export async function fetchDepositDocuments(requestId: string): Promise<DepositDocument[]> {
  const { data } = await api.get<DepositDocument[]>(`/deposits/${requestId}/documents`);
  return data;
}

/**
 * URL de telechargement.
 *
 * On renvoie l URL de l API, pas celle du stockage : le backend repond par une
 * redirection vers une signature de 60 secondes. Un lien direct vers MinIO
 * depuis le frontend serait soit invalide, soit une fuite d identifiants.
 */
export function buildDocumentDownloadUrl(requestId: string, documentId: string): string {
  return `/api/deposits/${requestId}/documents/${documentId}/download`;
}
