import type { Document, DepositRequest, Lawyer } from '@prisma/client';
import type { ConfigService } from '@nestjs/config';
import type { MetricsService } from '../metrics/metrics.service';

/**
 * Fabriques de donnees et de doubles, partagees par les suites.
 *
 * Tout est explicite et surchargeable : un test qui porte sur l expiration
 * ecrit `expiresAt`, et le lecteur voit immediatement que c est la SEULE chose
 * qui distingue ce cas des autres.
 */

export const LAWYER_A = '11111111-1111-4111-8111-111111111111';
export const LAWYER_B = '22222222-2222-4222-8222-222222222222';
export const REQUEST_A = '33333333-3333-4333-8333-333333333333';
export const REQUEST_B = '44444444-4444-4444-8444-444444444444';
export const DOCUMENT_A = '55555555-5555-4555-8555-555555555555';

const HOUR = 3_600_000;

export function lawyer(id: string, overrides: Partial<Lawyer> = {}): Lawyer {
  return {
    id,
    email: `${id.slice(0, 4)}@div-protocol.test`,
    passwordHash: '$argon2id$invalide',
    displayName: `Maitre ${id.slice(0, 4)}`,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    ...overrides,
  } as Lawyer;
}

export function depositRequest(
  id: string,
  lawyerId: string,
  overrides: Partial<DepositRequest> = {},
): DepositRequest {
  return {
    id,
    lawyerId,
    title: 'Pieces justificatives',
    instructions: null,
    clientName: 'Claire Nadeau',
    clientEmail: null,
    status: 'PENDING',
    tokenHash: 'a'.repeat(64),
    pinHash: '$argon2id$invalide',
    // Une heure dans le futur : la demande est ouverte par defaut.
    expiresAt: new Date(Date.now() + HOUR),
    failedAttempts: 0,
    lockedUntil: null,
    submittedAt: null,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    ...overrides,
  } as DepositRequest;
}

export function document(
  id: string,
  requestId: string,
  overrides: Partial<Document> = {},
): Document {
  return {
    id,
    requestId,
    originalName: 'avis.pdf',
    storageKey: `deposits/${requestId}/${id}/avis.pdf`,
    mimeType: 'application/pdf',
    sizeBytes: BigInt(1024),
    status: 'AVAILABLE',
    confirmedAt: new Date('2026-01-01T00:00:00Z'),
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    ...overrides,
  } as Document;
}

/**
 * ConfigService reduit a une table de correspondance.
 *
 * Le vrai ConfigService lit un .env et valide un schema zod : l embarquer dans
 * un test unitaire rendrait le resultat dependant de l environnement de la
 * machine, ce qui est l inverse d un test deterministe.
 */
export function fakeConfig(values: Record<string, unknown>): ConfigService<never, true> {
  return {
    get: (key: string) => values[key],
  } as unknown as ConfigService<never, true>;
}

/** Instrumentation observable : les compteurs sont une consequence testable. */
export function fakeMetrics() {
  const recorded: string[] = [];
  const service = {
    recordHttpRequest: () => recorded.push('http'),
    depositRequestCreated: () => recorded.push('deposit.created'),
    depositSubmitted: () => recorded.push('deposit.submitted'),
    pinVerified: (outcome: string) => recorded.push(`pin.${outcome}`),
    documentUpload: (outcome: string) => recorded.push(`upload.${outcome}`),
  };
  return { metrics: service as unknown as MetricsService, recorded };
}
