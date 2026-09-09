import { Injectable, Logger, OnModuleInit, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { randomBytes } from 'node:crypto';
import * as argon2 from 'argon2';
import type { Env } from '../config/env.validation';
import { PrismaService } from '../prisma/prisma.service';
import type { AuthenticatedLawyer, LawyerJwtClaims } from './auth.types';

/** Resultat d'une connexion reussie : le token et sa date d'expiration. */
export interface IssuedSession {
  token: string;
  expiresAt: Date;
  lawyer: AuthenticatedLawyer;
}

/**
 * Toute la logique de connexion vit ici. Le controleur ne fait que traduire
 * HTTP <-> service.
 */
@Injectable()
export class AuthService implements OnModuleInit {
  private readonly logger = new Logger(AuthService.name);

  /**
   * Hash factice, calcule une fois au demarrage sur une valeur aleatoire.
   *
   * Il sert a verifier un mot de passe MEME quand l'adresse est inconnue :
   * sans cela, une adresse inexistante repondrait en une milliseconde et une
   * adresse existante en cent, ce qui permet d'enumerer les comptes par simple
   * mesure du temps de reponse.
   */
  private decoyHash = '';

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  async onModuleInit(): Promise<void> {
    this.decoyHash = await argon2.hash(randomBytes(32).toString('hex'), {
      type: argon2.argon2id,
    });
  }

  /**
   * Verifie les identifiants et emet une session.
   *
   * En cas d'echec, l'erreur est identique que l'adresse soit inconnue ou que
   * le mot de passe soit faux : l'API ne confirme jamais l'existence d'un
   * compte.
   */
  async login(email: string, password: string): Promise<IssuedSession> {
    const lawyer = await this.prisma.lawyer.findUnique({ where: { email } });

    const passwordMatches = await this.verifyPassword(
      lawyer?.passwordHash ?? this.decoyHash,
      password,
    );

    if (!lawyer || !passwordMatches) {
      this.logger.warn(`Echec de connexion pour ${email}`);
      throw new UnauthorizedException('Identifiants invalides.');
    }

    // Pas de claim aud ici : l'audience est posee par signOptions dans
    // AuthModule. Une seule source, sinon la signature echoue.
    const claims: LawyerJwtClaims = {
      sub: lawyer.id,
      email: lawyer.email,
    };

    // La duree de vie est definie une seule fois, par JWT_LAWYER_TTL. On lit
    // ensuite l'expiration DANS le token pour dater le cookie : les deux ne
    // peuvent donc pas divergerent.
    const token = await this.jwt.signAsync(claims);
    const decoded = this.jwt.decode<{ exp: number }>(token);

    this.logger.log(`Connexion reussie : ${lawyer.email}`);

    return {
      token,
      expiresAt: new Date(decoded.exp * 1000),
      lawyer: { id: lawyer.id, email: lawyer.email },
    };
  }

  /** Profil de l'avocat authentifie. */
  async getProfile(lawyerId: string) {
    const lawyer = await this.prisma.lawyer.findUnique({
      where: { id: lawyerId },
      // Selection explicite : passwordHash ne doit jamais pouvoir sortir du
      // service par inadvertance.
      select: { id: true, email: true, displayName: true, createdAt: true },
    });

    if (!lawyer) {
      // Le token est valide mais le compte n'existe plus (supprime pendant la
      // duree de vie du token).
      throw new UnauthorizedException('Session invalide.');
    }

    return lawyer;
  }

  /**
   * Un hash malforme en base ne doit pas produire une erreur 500 : c'est un
   * echec d'authentification, pas un incident serveur.
   */
  private async verifyPassword(hash: string, password: string): Promise<boolean> {
    try {
      return await argon2.verify(hash, password);
    } catch {
      return false;
    }
  }
}
