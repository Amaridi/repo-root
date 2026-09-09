import { describe, expect, it } from '@jest/globals';
import { UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { DepositSessionGuard } from '../../deposit-access/guards/deposit-session.guard';
import {
  DEPOSIT_SESSION_COOKIE,
  DEPOSIT_TOKEN_AUDIENCE,
} from '../../deposit-access/deposit-access.constants';
import { REQUEST_A, LAWYER_A, fakeConfig } from '../../testing/fixtures';
import { contextWithCookies } from '../../testing/execution-context';
import { LAWYER_SESSION_COOKIE, LAWYER_TOKEN_AUDIENCE } from '../auth.constants';
import { JwtAuthGuard } from './jwt-auth.guard';

const SECRET_AVOCAT = 'secret-avocat-de-test-suffisamment-long';
const SECRET_DEPOT = 'secret-depot-de-test-suffisamment-long';

/**
 * Cloisonnement des deux sessions.
 *
 * C est la suite la plus importante du projet. Elle repond a une seule question,
 * posee dans les deux sens : un client anonyme peut-il atteindre l espace de
 * l avocat, et un avocat peut-il se substituer a un client ?
 *
 * Rien n est mocke du mecanisme sous test : les tokens sont reellement signes et
 * reellement verifies, avec deux secrets distincts, par les gardes de
 * production. Un test qui simulerait la verification ne prouverait rien.
 */
describe('Cloisonnement avocat / client', () => {
  const jwtAvocat = new JwtService({
    secret: SECRET_AVOCAT,
    signOptions: { expiresIn: '8h', audience: LAWYER_TOKEN_AUDIENCE },
  });
  const jwtDepot = new JwtService({
    secret: SECRET_DEPOT,
    signOptions: { expiresIn: '30m', audience: DEPOSIT_TOKEN_AUDIENCE },
  });

  const gardeAvocat = new JwtAuthGuard(
    jwtAvocat,
    fakeConfig({ JWT_LAWYER_SECRET: SECRET_AVOCAT }),
  );
  const gardeClient = new DepositSessionGuard(
    jwtDepot,
    fakeConfig({ JWT_DEPOSIT_SECRET: SECRET_DEPOT }),
  );

  /** Token avocat, tel qu emis par AuthService. */
  const tokenAvocat = () => jwtAvocat.sign({ sub: LAWYER_A, email: 'avocat@div-protocol.test' });

  /** Token de session de depot, tel qu emis par DepositAccessService. */
  const tokenClient = () => jwtDepot.sign({ sub: REQUEST_A, scope: 'deposit' });

  describe('garde avocat', () => {
    it('laisse passer une session avocat valide et expose l identite', async () => {
      const { context, request } = contextWithCookies({ [LAWYER_SESSION_COOKIE]: tokenAvocat() });

      await expect(gardeAvocat.canActivate(context)).resolves.toBe(true);
      // L identite est injectee par la garde : aucun controleur ne decode de
      // token lui-meme.
      expect(request.lawyer).toEqual({ id: LAWYER_A, email: 'avocat@div-protocol.test' });
    });

    it('refuse une requete sans aucun cookie', async () => {
      // « Route protegee inaccessible sans authentification » : la garde etant
      // posee sur les controleurs entiers, ce refus vaut pour toutes leurs
      // routes.
      const { context } = contextWithCookies(undefined);
      await expect(gardeAvocat.canActivate(context)).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it('refuse un cookie present mais vide', async () => {
      const { context } = contextWithCookies({ [LAWYER_SESSION_COOKIE]: '' });
      await expect(gardeAvocat.canActivate(context)).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it('ignore un autre cookie, meme porteur d un token valide', async () => {
      // Le token est bon, mais il n est pas dans le cookie attendu.
      const { context } = contextWithCookies({ [DEPOSIT_SESSION_COOKIE]: tokenAvocat() });
      await expect(gardeAvocat.canActivate(context)).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it('REFUSE un token de session client', async () => {
      // Le cas central : le client presente sa session de depot, correctement
      // signee avec SA cle, dans le cookie avocat. Deux barrieres le refusent —
      // la cle de signature et l audience.
      const { context, request } = contextWithCookies({
        [LAWYER_SESSION_COOKIE]: tokenClient(),
      });

      await expect(gardeAvocat.canActivate(context)).rejects.toBeInstanceOf(UnauthorizedException);
      // Et surtout : aucune identite n a ete injectee au passage.
      expect(request.lawyer).toBeUndefined();
    });

    it('refuse un token signe avec la bonne cle mais la mauvaise audience', async () => {
      // Scenario d erreur de configuration : les deux secrets pointent par
      // accident sur la meme valeur. L audience reste la seconde barriere, et
      // c est sa seule raison d exister.
      const usurpe = new JwtService({ secret: SECRET_AVOCAT }).sign(
        { sub: REQUEST_A, scope: 'deposit' },
        { audience: DEPOSIT_TOKEN_AUDIENCE },
      );
      const { context } = contextWithCookies({ [LAWYER_SESSION_COOKIE]: usurpe });

      await expect(gardeAvocat.canActivate(context)).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it('refuse un token sans audience du tout', async () => {
      const sansAudience = new JwtService({ secret: SECRET_AVOCAT }).sign({ sub: LAWYER_A });
      const { context } = contextWithCookies({ [LAWYER_SESSION_COOKIE]: sansAudience });

      await expect(gardeAvocat.canActivate(context)).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it('refuse un token expire', async () => {
      const expire = new JwtService({ secret: SECRET_AVOCAT }).sign(
        { sub: LAWYER_A },
        { audience: LAWYER_TOKEN_AUDIENCE, expiresIn: '-1s' },
      );
      const { context } = contextWithCookies({ [LAWYER_SESSION_COOKIE]: expire });

      await expect(gardeAvocat.canActivate(context)).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it('refuse un token dont la charge utile a ete modifiee', async () => {
      // Substitution d identite : on remplace le sub par celui d un autre
      // avocat sans pouvoir resigner. La signature ne colle plus.
      const [entete, , signature] = tokenAvocat().split('.');
      const charge = Buffer.from(
        JSON.stringify({ sub: 'un-autre-avocat', aud: LAWYER_TOKEN_AUDIENCE }),
      ).toString('base64url');
      const { context } = contextWithCookies({
        [LAWYER_SESSION_COOKIE]: `${entete}.${charge}.${signature}`,
      });

      await expect(gardeAvocat.canActivate(context)).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it('refuse une chaine qui n est pas un token', async () => {
      for (const cochonnerie of ['bonjour', 'a.b.c', '...', '{}']) {
        const { context } = contextWithCookies({ [LAWYER_SESSION_COOKIE]: cochonnerie });
        await expect(gardeAvocat.canActivate(context)).rejects.toBeInstanceOf(
          UnauthorizedException,
        );
      }
    });
  });

  describe('garde client', () => {
    it('laisse passer une session de depot valide et expose la demande visee', async () => {
      const { context, request } = contextWithCookies({ [DEPOSIT_SESSION_COOKIE]: tokenClient() });

      await expect(gardeClient.canActivate(context)).resolves.toBe(true);
      const session = request.depositSession as { requestId: string; expiresAt: Date };
      // La session est liee a UNE demande : c est cet identifiant, et lui seul,
      // que les services utiliseront ensuite.
      expect(session.requestId).toBe(REQUEST_A);
      expect(session.expiresAt.getTime()).toBeGreaterThan(Date.now());
    });

    it('refuse une requete sans session', async () => {
      const { context } = contextWithCookies(undefined);
      await expect(gardeClient.canActivate(context)).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it('REFUSE un token avocat', async () => {
      // Le sens inverse : une session avocat ne se substitue pas a une session
      // client. Un avocat authentifie n a rien a faire sur les routes de depot.
      const { context, request } = contextWithCookies({
        [DEPOSIT_SESSION_COOKIE]: tokenAvocat(),
      });

      await expect(gardeClient.canActivate(context)).rejects.toBeInstanceOf(UnauthorizedException);
      expect(request.depositSession).toBeUndefined();
    });

    it('refuse un token correctement signe et adresse mais sans le scope attendu', async () => {
      // Troisieme barriere, apres la cle et l audience.
      const sansScope = jwtDepot.sign({ sub: REQUEST_A });
      const { context } = contextWithCookies({ [DEPOSIT_SESSION_COOKIE]: sansScope });

      await expect(gardeClient.canActivate(context)).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it('refuse une session de depot expiree', async () => {
      const expire = new JwtService({ secret: SECRET_DEPOT }).sign(
        { sub: REQUEST_A, scope: 'deposit' },
        { audience: DEPOSIT_TOKEN_AUDIENCE, expiresIn: '-1s' },
      );
      const { context } = contextWithCookies({ [DEPOSIT_SESSION_COOKIE]: expire });

      await expect(gardeClient.canActivate(context)).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it('renvoie le meme message quelle que soit la raison du refus', async () => {
      // Le client ne doit pas pouvoir distinguer « pas de session » de
      // « session expiree » ou « mauvaise cle » : ce serait un oracle.
      const raisons = [
        undefined,
        { [DEPOSIT_SESSION_COOKIE]: tokenAvocat() },
        { [DEPOSIT_SESSION_COOKIE]: jwtDepot.sign({ sub: REQUEST_A }) },
        { [DEPOSIT_SESSION_COOKIE]: 'nawak' },
      ];

      const reponses = [];
      for (const cookies of raisons) {
        const { context } = contextWithCookies(cookies);
        reponses.push(await gardeClient.canActivate(context).catch((e) => e.getResponse()));
      }

      expect(new Set(reponses.map((r) => JSON.stringify(r))).size).toBe(1);
    });
  });

  describe('les deux cookies coexistent dans le meme navigateur', () => {
    it('chaque garde ne lit que le sien', async () => {
      // Cas reel : un avocat qui teste le lien qu il vient d envoyer porte les
      // deux cookies a la fois. Aucune confusion ne doit en resulter.
      const cookies = {
        [LAWYER_SESSION_COOKIE]: tokenAvocat(),
        [DEPOSIT_SESSION_COOKIE]: tokenClient(),
      };

      const avocat = contextWithCookies({ ...cookies });
      await expect(gardeAvocat.canActivate(avocat.context)).resolves.toBe(true);
      expect(avocat.request.lawyer).toEqual({
        id: LAWYER_A,
        email: 'avocat@div-protocol.test',
      });
      // La garde avocat n a rien pose concernant la session de depot.
      expect(avocat.request.depositSession).toBeUndefined();

      const client = contextWithCookies({ ...cookies });
      await expect(gardeClient.canActivate(client.context)).resolves.toBe(true);
      expect((client.request.depositSession as { requestId: string }).requestId).toBe(REQUEST_A);
      expect(client.request.lawyer).toBeUndefined();
    });
  });
});
