import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import * as argon2 from 'argon2';
import type { Env } from '../config/env.validation';
import { PrismaService } from '../prisma/prisma.service';
import {
  buildDepositUrl,
  generateAccessToken,
  generatePin,
  hashAccessToken,
} from './deposit-secrets';
import type { CreateDepositRequestDto } from './dto/create-deposit-request.dto';
import {
  type CreatedDepositRequestView,
  type DepositRequestView,
  toDepositRequestView,
} from './dto/deposit-request.view';

/**
 * Demandes de depot, cote avocat authentifie.
 *
 * Le parcours client anonyme (resolution du token, verification du PIN) vivra
 * dans un module distinct : deux surfaces d'attaque et deux modeles
 * d'autorisation differents ne partagent pas un service.
 */
@Injectable()
export class DepositService {
  private readonly logger = new Logger(DepositService.name);

  /**
   * Le comptage des documents accompagne chaque lecture : c'est ce qui permet a
   * l'avocat de suivre l'avancement sans ouvrir la demande.
   */
  private static readonly WITH_DOCUMENT_COUNT = {
    _count: { select: { documents: true } },
  } satisfies Prisma.DepositRequestInclude;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  /**
   * Cree une demande et ses deux secrets d'acces.
   *
   * Le token du lien et le PIN sont generes COTE SERVEUR : l'avocat ne les
   * choisit pas. Un secret choisi par un humain serait devinable, et surtout il
   * transiterait dans le corps de la requete et donc dans les journaux.
   *
   * Seules les empreintes sont persistees. Les valeurs en clair ne sont
   * retournees qu'ici, une fois.
   */
  async create(lawyerId: string, dto: CreateDepositRequestDto): Promise<CreatedDepositRequestView> {
    const token = generateAccessToken();
    const pin = generatePin();

    // Duree de validite fixe, pilotee par la seule configuration : l avocat ne
    // la choisit pas. Un lien de depot est un secret, sa duree de vie est une
    // decision de securite, pas un reglage d interface.
    const ttlDays = this.config.get('DEPOSIT_LINK_TTL_DAYS', { infer: true });

    const expiresAt = new Date(Date.now() + ttlDays * 24 * 60 * 60 * 1000);

    const created = await this.prisma.depositRequest.create({
      data: {
        lawyerId,
        title: dto.title,
        instructions: dto.instructions ?? null,
        clientName: dto.clientName,
        clientEmail: dto.clientEmail ?? null,
        tokenHash: hashAccessToken(token),
        pinHash: await argon2.hash(pin, { type: argon2.argon2id }),
        expiresAt,
        // status vaut PENDING par defaut : la demande existe, le client n'a
        // encore rien depose.
      },
      include: DepositService.WITH_DOCUMENT_COUNT,
    });

    // Le PIN et le token n'apparaissent dans aucun journal.
    this.logger.log(`Demande creee ${created.id} par l'avocat ${lawyerId}`);

    return {
      request: toDepositRequestView(created),
      access: {
        depositUrl: buildDepositUrl(this.config.get('PUBLIC_BASE_URL', { infer: true }), token),
        pin,
      },
    };
  }

  /**
   * Demandes de l'avocat courant, les plus recentes d'abord.
   *
   * Le filtre par lawyerId est dans le WHERE, pas dans un controle a
   * posteriori : il n'existe aucun chemin de code qui lise les demandes d'un
   * autre avocat.
   */
  async findAllForLawyer(lawyerId: string): Promise<DepositRequestView[]> {
    const requests = await this.prisma.depositRequest.findMany({
      where: { lawyerId },
      orderBy: { createdAt: 'desc' },
      include: DepositService.WITH_DOCUMENT_COUNT,
    });

    const now = new Date();
    return requests.map((request) => toDepositRequestView(request, now));
  }

  /**
   * Detail d'une demande appartenant a l'avocat courant.
   *
   * L'identifiant ET le proprietaire sont dans la meme clause WHERE. Un
   * identifiant valide appartenant a un autre avocat produit donc exactement la
   * meme reponse qu'un identifiant inexistant : 404 et non 403, pour ne pas
   * confirmer l'existence de la demande.
   */
  async findOneForLawyer(lawyerId: string, id: string): Promise<DepositRequestView> {
    const request = await this.prisma.depositRequest.findFirst({
      where: { id, lawyerId },
      include: DepositService.WITH_DOCUMENT_COUNT,
    });

    if (!request) {
      throw new NotFoundException('Demande de depot introuvable.');
    }

    return toDepositRequestView(request);
  }
}
