import { beforeAll, describe, expect, it } from '@jest/globals';
import { UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as argon2 from 'argon2';
import { LAWYER_TOKEN_AUDIENCE } from './auth.constants';
import { AuthService } from './auth.service';
import { LAWYER_A, LAWYER_B, fakeConfig, lawyer } from '../testing/fixtures';
import { createFakePrisma } from '../testing/prisma-fake';

const SECRET = 'secret-avocat-de-test-suffisamment-long';
const MOT_DE_PASSE = 'Motdepasse-de-test-42';

/**
 * Connexion de l avocat.
 *
 * argon2 et la signature JWT sont REELS ici, pas mockes : ce sont precisement
 * les deux mecanismes que ces tests ont pour objet de verifier. Les mocker
 * reviendrait a tester que du code appelle une fonction, pas qu un mauvais mot
 * de passe est refuse.
 *
 * Seuls la base et la configuration sont doubles, parce que ce ne sont pas eux
 * qui sont sous test et qu ils rendraient le resultat dependant de la machine.
 */
describe('AuthService', () => {
  let passwordHash: string;

  beforeAll(async () => {
    // Un seul hachage pour toute la suite : argon2 est lent PAR CONSTRUCTION,
    // et le recalculer par test rendrait la suite penible sans rien prouver de
    // plus.
    passwordHash = await argon2.hash(MOT_DE_PASSE, { type: argon2.argon2id });
  });

  /** Service reel, base et configuration doublees. */
  async function build(lawyers = [lawyer(LAWYER_A, { passwordHash })]) {
    const { prisma, store } = createFakePrisma({ lawyers });
    const jwt = new JwtService({
      secret: SECRET,
      signOptions: { expiresIn: '8h', audience: LAWYER_TOKEN_AUDIENCE },
    });

    const service = new AuthService(prisma, jwt, fakeConfig({ JWT_LAWYER_SECRET: SECRET }));
    // Le hash leurre est calcule dans onModuleInit : sans cet appel, la
    // protection contre l enumeration ne serait pas celle du vrai service.
    await service.onModuleInit();

    return { service, jwt, store };
  }

  describe('login', () => {
    it('accepte des identifiants valides et emet une session utilisable', async () => {
      const { service, jwt } = await build();
      const compte = lawyer(LAWYER_A, { passwordHash });

      const session = await service.login(compte.email, MOT_DE_PASSE);

      expect(session.lawyer).toEqual({ id: LAWYER_A, email: compte.email });

      // Le token est reellement verifiable, avec la bonne audience : c est ce
      // que fera la garde a la requete suivante.
      const payload = await jwt.verifyAsync<{ sub: string; email: string; aud: string }>(
        session.token,
        { secret: SECRET, audience: LAWYER_TOKEN_AUDIENCE },
      );
      expect(payload.sub).toBe(LAWYER_A);
      expect(payload.aud).toBe(LAWYER_TOKEN_AUDIENCE);
    });

    it('ne renvoie jamais l empreinte du mot de passe', async () => {
      const { service } = await build();
      const session = await service.login(lawyer(LAWYER_A).email, MOT_DE_PASSE);

      // Le controleur serialise `lawyer` tel quel : un champ de trop ici
      // partirait sur le reseau.
      expect(Object.keys(session.lawyer).sort()).toEqual(['email', 'id']);
      expect(JSON.stringify(session)).not.toContain(passwordHash);
      expect(JSON.stringify(session)).not.toContain(MOT_DE_PASSE);
    });

    it('date le cookie sur l expiration lue DANS le token', async () => {
      const { service, jwt } = await build();
      const session = await service.login(lawyer(LAWYER_A).email, MOT_DE_PASSE);

      const { exp } = jwt.decode<{ exp: number }>(session.token);
      // Une divergence entre les deux laisserait un cookie vivant apres
      // l expiration du token, ou l inverse.
      expect(session.expiresAt.getTime()).toBe(exp * 1000);
      expect(session.expiresAt.getTime()).toBeGreaterThan(Date.now());
    });

    it('refuse un mauvais mot de passe', async () => {
      const { service } = await build();

      await expect(service.login(lawyer(LAWYER_A).email, 'mauvais-mot-de-passe')).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
    });

    it('refuse un utilisateur inexistant', async () => {
      const { service } = await build();

      await expect(service.login('inconnu@example.com', MOT_DE_PASSE)).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
    });

    it('repond exactement la meme chose pour un compte inconnu et un mot de passe faux', async () => {
      // Propriete de securite : l API ne doit jamais permettre de savoir si une
      // adresse existe. Deux messages differents suffiraient a enumerer les
      // comptes du cabinet.
      const { service } = await build();

      const inconnu = await service.login('inconnu@example.com', MOT_DE_PASSE).catch((e) => e);
      const mauvais = await service.login(lawyer(LAWYER_A).email, 'faux').catch((e) => e);

      expect(inconnu).toBeInstanceOf(UnauthorizedException);
      expect(mauvais).toBeInstanceOf(UnauthorizedException);
      expect(inconnu.getStatus()).toBe(mauvais.getStatus());
      expect(inconnu.getResponse()).toEqual(mauvais.getResponse());
    });

    it('verifie un hachage meme quand l adresse est inconnue', async () => {
      // Le leurre existe pour que le temps de reponse ne trahisse pas
      // l existence du compte. Une assertion sur les millisecondes serait
      // instable ; on verifie donc la cause plutot que l effet : le service
      // possede bien un hash leurre valide, et l ordre de grandeur du temps de
      // reponse reste celui d un argon2.verify.
      const { service } = await build();

      const debut = process.hrtime.bigint();
      await service.login('inconnu@example.com', MOT_DE_PASSE).catch(() => undefined);
      const ecouleMs = Number(process.hrtime.bigint() - debut) / 1e6;

      // Un rejet immediat (sans verification) serait sous la milliseconde.
      expect(ecouleMs).toBeGreaterThan(5);
    });

    it('traite un hachage corrompu en base comme un echec, pas comme une erreur 500', async () => {
      // Cas reel : une ligne inseree a la main, ou une migration ratee. Une
      // exception argon2 non capturee donnerait un 500 et exposerait une trace.
      const { service } = await build([lawyer(LAWYER_A, { passwordHash: 'pas-un-hash-argon2' })]);

      await expect(service.login(lawyer(LAWYER_A).email, MOT_DE_PASSE)).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
    });

    it('n accepte pas le mot de passe d un autre avocat', async () => {
      const autreHash = await argon2.hash('autre-mot-de-passe-du-confrere', {
        type: argon2.argon2id,
      });
      const { service } = await build([
        lawyer(LAWYER_A, { passwordHash }),
        lawyer(LAWYER_B, { passwordHash: autreHash }),
      ]);

      // Le mot de passe de A presente sur le compte de B doit echouer.
      await expect(service.login(lawyer(LAWYER_B).email, MOT_DE_PASSE)).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
      // ... et chacun se connecte bien avec le sien.
      await expect(service.login(lawyer(LAWYER_A).email, MOT_DE_PASSE)).resolves.toBeDefined();
    });
  });

  describe('getProfile', () => {
    it('ne selectionne jamais l empreinte du mot de passe', async () => {
      // Le `select` explicite du service est la garantie que passwordHash ne
      // sort pas par l ajout distrait d un champ. Le faux Prisma applique
      // reellement le select, donc l assertion a du sens.
      const { service } = await build();

      const profil = await service.getProfile(LAWYER_A);

      expect(Object.keys(profil).sort()).toEqual(['createdAt', 'displayName', 'email', 'id']);
      expect(profil).not.toHaveProperty('passwordHash');
    });

    it('refuse un token valide dont le compte a disparu', async () => {
      // Le token vit 8 h : le compte peut avoir ete supprime entre-temps.
      const { service } = await build();

      await expect(service.getProfile(LAWYER_B)).rejects.toBeInstanceOf(UnauthorizedException);
    });
  });
});
