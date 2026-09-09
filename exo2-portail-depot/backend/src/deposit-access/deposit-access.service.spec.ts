// En mode ESM, les globales de Jest ne sont pas injectees : elles s importent.
import { describe, expect, it, jest } from '@jest/globals';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import type { JwtService } from '@nestjs/jwt';
import type { DepositRequest } from '@prisma/client';
import { DepositAccessService } from './deposit-access.service';
import type { PrismaService } from '../prisma/prisma.service';

/**
 * Soumission du depot par le client.
 *
 * Prisma est mocke : ces tests portent sur les REGLES, pas sur la base. Les
 * memes regles sont verifiees de bout en bout contre PostgreSQL et MinIO, mais
 * ici on peut fabriquer les cas limites (statut change en cours de route) qui
 * seraient difficiles a provoquer autrement.
 */
describe('DepositAccessService.submit', () => {
  const REQUEST_ID = '11111111-1111-4111-8111-111111111111';

  function openRequest(overrides: Partial<DepositRequest> = {}): DepositRequest {
    return {
      id: REQUEST_ID,
      lawyerId: '22222222-2222-4222-8222-222222222222',
      title: 'Pieces justificatives',
      instructions: null,
      clientName: 'Claire Nadeau',
      clientEmail: null,
      status: 'IN_PROGRESS',
      tokenHash: 'a'.repeat(64),
      pinHash: '$argon2id$fake',
      // Une heure dans le futur : la demande est ouverte.
      expiresAt: new Date(Date.now() + 3_600_000),
      failedAttempts: 0,
      lockedUntil: null,
      submittedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      ...overrides,
    } as DepositRequest;
  }

  function build(request: DepositRequest | null, availableDocuments: number, updated = 1) {
    // jest.fn(async () => ...) plutot que .mockResolvedValue() : les globales
    // importees depuis @jest/globals sont typees strictement, et la valeur de
    // retour est ainsi inferee au lieu d etre 'never'.
    const prisma = {
      depositRequest: {
        findUnique: jest.fn(async () => request),
        updateMany: jest.fn(async () => ({ count: updated })),
      },
      document: {
        count: jest.fn(async () => availableDocuments),
      },
    } as unknown as PrismaService;

    const service = new DepositAccessService(
      prisma,
      {} as JwtService,
      {} as ConfigService<never, true>,
    );

    return { service, prisma: prisma as unknown as MockedPrisma };
  }

  /** Vue mockee, pour inspecter les appels sans lutter contre les types Prisma. */
  interface MockedPrisma {
    depositRequest: { findUnique: jest.Mock; updateMany: jest.Mock };
    document: { count: jest.Mock };
  }

  it('passe la demande a SUBMITTED et renseigne submittedAt', async () => {
    const { service, prisma } = build(openRequest(), 3);

    const before = Date.now();
    const result = await service.submit(REQUEST_ID);

    expect(result.status).toBe('SUBMITTED');
    expect(result.documentsCount).toBe(3);
    expect(result.submittedAt.getTime()).toBeGreaterThanOrEqual(before);

    expect(prisma.depositRequest.updateMany).toHaveBeenCalledWith({
      where: { id: REQUEST_ID, status: { in: ['PENDING', 'IN_PROGRESS'] } },
      data: { status: 'SUBMITTED', submittedAt: result.submittedAt },
    });
  });

  it('ne compte que les documents AVAILABLE', async () => {
    const { service, prisma } = build(openRequest(), 1);

    await service.submit(REQUEST_ID);

    expect(prisma.document.count).toHaveBeenCalledWith({
      where: { requestId: REQUEST_ID, status: 'AVAILABLE' },
    });
  });

  it('refuse une soumission sans aucun document disponible', async () => {
    const { service, prisma } = build(openRequest(), 0);

    await expect(service.submit(REQUEST_ID)).rejects.toBeInstanceOf(BadRequestException);
    // Le statut ne doit surtout pas avoir bouge.
    expect(prisma.depositRequest.updateMany).not.toHaveBeenCalled();
  });

  it('refuse une demande expiree', async () => {
    const { service, prisma } = build(openRequest({ expiresAt: new Date(Date.now() - 1000) }), 2);

    await expect(service.submit(REQUEST_ID)).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.depositRequest.updateMany).not.toHaveBeenCalled();
  });

  it('refuse une demande deja soumise', async () => {
    const { service, prisma } = build(openRequest({ status: 'SUBMITTED' }), 2);

    await expect(service.submit(REQUEST_ID)).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.depositRequest.updateMany).not.toHaveBeenCalled();
  });

  it('refuse une demande cloturee par l avocat', async () => {
    const { service } = build(openRequest({ status: 'CLOSED' }), 2);

    await expect(service.submit(REQUEST_ID)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('refuse une demande inexistante', async () => {
    const { service } = build(null, 2);

    await expect(service.submit(REQUEST_ID)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('echoue si le statut a change entre la verification et l ecriture', async () => {
    // updateMany ne touche aucune ligne : une autre requete a soumis ou cloture
    // la demande entre-temps. La transition ne doit pas etre annoncee comme
    // reussie.
    const { service } = build(openRequest(), 2, 0);

    await expect(service.submit(REQUEST_ID)).rejects.toBeInstanceOf(NotFoundException);
  });
});
