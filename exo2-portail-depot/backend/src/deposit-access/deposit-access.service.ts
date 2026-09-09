import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import type { DepositRequest } from '@prisma/client';
import * as argon2 from 'argon2';
import type { Env } from '../config/env.validation';
import { hashAccessToken } from '../deposit/deposit-secrets';
import { MetricsService } from '../metrics/metrics.service';
import { PrismaService } from '../prisma/prisma.service';
import { ACCESS_TOKEN_PATTERN } from './deposit-access.constants';
import type { DepositJwtClaims } from './deposit-access.types';
import type { DepositSessionView, PublicDepositView } from './dto/public-deposit.view';

export interface IssuedDepositSession {
  token: string;
  expiresAt: Date;
}

export interface PinVerificationResult extends IssuedDepositSession {
  deposit: PublicDepositView;
}

/**
 * Parcours client anonyme.
 *
 * Module distinct de DepositModule alors que les deux lisent la meme table :
 * ce sont deux surfaces d'attaque et deux modeles d'autorisation differents.
 * La separation rend structurellement impossible qu'un DTO partage laisse
 * fuiter pinHash, tokenHash ou l'identite de l'avocat.
 */
@Injectable()
export class DepositAccessService {
  private readonly logger = new Logger(DepositAccessService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService<Env, true>,
    private readonly metrics: MetricsService,
  ) {}

  /**
   * Metadonnees d'affichage, avant saisie du PIN.
   */
  async resolve(token: string): Promise<PublicDepositView> {
    const request = await this.loadOpenRequest(token);

    const lawyer = await this.prisma.lawyer.findUniqueOrThrow({
      where: { id: request.lawyerId },
      select: { displayName: true },
    });

    return {
      title: request.title,
      instructions: request.instructions,
      lawyerName: lawyer.displayName,
      clientName: request.clientName,
      expiresAt: request.expiresAt,
    };
  }

  /**
   * Verifie le PIN et ouvre une session de depot.
   *
   * Le compteur de tentatives est porte par la DEMANDE et non par l'adresse IP :
   * changer d'IP ne remet rien a zero. Il est persiste en base et non en
   * memoire, donc un redemarrage de l'API ne l'efface pas — c'est la difference
   * entre une protection et une decoration.
   */
  async verifyPin(token: string, pin: string): Promise<PinVerificationResult> {
    const request = await this.loadOpenRequest(token);
    const maxAttempts = this.config.get('PIN_MAX_ATTEMPTS', { infer: true });

    if (request.lockedUntil && request.lockedUntil.getTime() > Date.now()) {
      const retryAfterSeconds = Math.ceil((request.lockedUntil.getTime() - Date.now()) / 1000);
      this.metrics.pinVerified('locked');
      throw new ForbiddenException({
        message: 'Trop de tentatives. Acces temporairement bloque.',
        retryAfterSeconds,
      });
    }

    const valid = await this.verifyHash(request.pinHash, pin);

    if (!valid) {
      const failedAttempts = request.failedAttempts + 1;
      const reachedLimit = failedAttempts >= maxAttempts;

      await this.prisma.depositRequest.update({
        where: { id: request.id },
        data: reachedLimit
          ? {
              // Le verrou pose, le compteur repart de zero : apres expiration
              // du blocage le client dispose d une serie complete.
              failedAttempts: 0,
              lockedUntil: new Date(
                Date.now() + this.config.get('PIN_LOCK_MINUTES', { infer: true }) * 60_000,
              ),
            }
          : { failedAttempts },
      });

      this.logger.warn(
        `PIN invalide sur la demande ${request.id} (${failedAttempts}/${maxAttempts})`,
      );

      this.metrics.pinVerified('invalid');
      throw new UnauthorizedException({
        message: 'Code invalide.',
        attemptsLeft: reachedLimit ? 0 : maxAttempts - failedAttempts,
      });
    }

    if (request.failedAttempts > 0 || request.lockedUntil) {
      await this.prisma.depositRequest.update({
        where: { id: request.id },
        data: { failedAttempts: 0, lockedUntil: null },
      });
    }

    const session = await this.issueSession(request.id);
    this.logger.log(`Session de depot ouverte pour la demande ${request.id}`);
    this.metrics.pinVerified('success');

    return { ...session, deposit: await this.resolve(token) };
  }

  /**
   * Etat de la demande pour une session deja ouverte.
   *
   * L expiration est REVERIFIEE ici : une session emise avant l echeance ne
   * doit pas survivre au lien. Le token JWT seul ne suffit donc jamais.
   */
  async getSessionDeposit(requestId: string, sessionExpiresAt: Date): Promise<DepositSessionView> {
    const request = await this.assertOpenForDeposit(requestId);

    const [lawyer, documentsCount] = await Promise.all([
      this.prisma.lawyer.findUniqueOrThrow({
        where: { id: request.lawyerId },
        select: { displayName: true },
      }),
      this.prisma.document.count({
        where: { requestId: request.id, status: 'AVAILABLE' },
      }),
    ]);

    return {
      title: request.title,
      instructions: request.instructions,
      lawyerName: lawyer.displayName,
      clientName: request.clientName,
      expiresAt: request.expiresAt,
      status: request.status,
      documentsCount,
      sessionExpiresAt,
    };
  }

  /**
   * Soumission definitive par le client.
   *
   * Acte metier irreversible cote client : il ferme le lien public. Trois
   * garanties sont exigees avant la transition.
   *
   * 1. La demande est encore ouverte (expiration reverifiee).
   * 2. Elle contient au moins un document AVAILABLE — soumettre un dossier
   *    vide n aurait aucun sens, et les lignes PENDING ne comptent pas
   *    puisque leurs octets ne sont pas garantis.
   * 3. La transition est faite par updateMany avec le statut dans le WHERE.
   *    Deux requetes simultanees ne peuvent donc pas soumettre deux fois, et
   *    un statut CLOSED pose par l avocat entre-temps ne sera pas ecrase.
   */
  async submit(
    requestId: string,
  ): Promise<{ status: string; submittedAt: Date; documentsCount: number }> {
    await this.assertOpenForDeposit(requestId);

    const documentsCount = await this.prisma.document.count({
      where: { requestId, status: 'AVAILABLE' },
    });

    if (documentsCount === 0) {
      throw new BadRequestException(
        'Aucun document deposé. Ajoutez au moins une piece avant de soumettre.',
      );
    }

    const submittedAt = new Date();

    const { count } = await this.prisma.depositRequest.updateMany({
      where: { id: requestId, status: { in: ['PENDING', 'IN_PROGRESS'] } },
      data: { status: 'SUBMITTED', submittedAt },
    });

    if (count === 0) {
      // Le statut a change entre la verification et l ecriture.
      throw new NotFoundException('Demande de depot indisponible.');
    }

    this.logger.log(`Demande soumise ${requestId} (${documentsCount} documents)`);
    this.metrics.depositSubmitted();

    return { status: 'SUBMITTED', submittedAt, documentsCount };
  }
  /**
   * Garantit qu une demande est encore ouverte au depot.
   *
   * Point d entree unique, reutilise par le module de gestion des documents
   * (bloc 6) : aucune ecriture ne doit contourner cette verification.
   */
  async assertOpenForDeposit(requestId: string): Promise<DepositRequest> {
    const request = await this.prisma.depositRequest.findUnique({ where: { id: requestId } });

    if (!request || !this.isOpen(request)) {
      throw new NotFoundException('Demande de depot indisponible.');
    }

    return request;
  }

  /**
   * Charge une demande a partir de son token public.
   *
   * Reponse volontairement IDENTIQUE — 404, meme message — que le token soit
   * malforme, inconnu, expire, deja soumis ou cloture. Un scanner n apprend
   * donc jamais qu un token existe.
   *
   * La recherche se fait sur l empreinte : le token en clair n est jamais
   * compare a une valeur stockee, puisqu aucune ne l est.
   */
  private async loadOpenRequest(token: string): Promise<DepositRequest> {
    if (!ACCESS_TOKEN_PATTERN.test(token)) {
      throw new NotFoundException('Demande de depot indisponible.');
    }

    const request = await this.prisma.depositRequest.findUnique({
      where: { tokenHash: hashAccessToken(token) },
    });

    if (!request || !this.isOpen(request)) {
      throw new NotFoundException('Demande de depot indisponible.');
    }

    return request;
  }

  /**
   * Une demande est ouverte au depot si elle n est ni expiree, ni deja soumise,
   * ni cloturee. L expiration est une COMPARAISON, jamais un booleen persiste.
   */
  private isOpen(request: DepositRequest): boolean {
    if (request.expiresAt.getTime() <= Date.now()) return false;
    return request.status === 'PENDING' || request.status === 'IN_PROGRESS';
  }

  private async issueSession(requestId: string): Promise<IssuedDepositSession> {
    const claims: DepositJwtClaims = { sub: requestId, scope: 'deposit' };
    const token = await this.jwt.signAsync(claims);
    const decoded = this.jwt.decode<{ exp: number }>(token);
    return { token, expiresAt: new Date(decoded.exp * 1000) };
  }

  /** Un hash malforme est un echec d authentification, pas une erreur 500. */
  private async verifyHash(hash: string, pin: string): Promise<boolean> {
    try {
      return await argon2.verify(hash, pin);
    } catch {
      return false;
    }
  }
}
