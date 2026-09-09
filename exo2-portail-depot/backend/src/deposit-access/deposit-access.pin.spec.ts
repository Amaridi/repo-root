import { beforeAll, describe, expect, it } from '@jest/globals';
import {
  ForbiddenException,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as argon2 from 'argon2';
import { generateAccessToken, hashAccessToken } from '../deposit/deposit-secrets';
import {
  LAWYER_A,
  REQUEST_A,
  depositRequest,
  fakeConfig,
  fakeMetrics,
  lawyer,
} from '../testing/fixtures';
import { createFakePrisma } from '../testing/prisma-fake';
import { DEPOSIT_TOKEN_AUDIENCE } from './deposit-access.constants';
import { DepositAccessService } from './deposit-access.service';

const SECRET_DEPOT = 'secret-depot-de-test-suffisamment-long';
const PIN = '048213';
const MAX_TENTATIVES = 5;

/**
 * Acces public : token du lien, code PIN, expiration, verrouillage.
 *
 * argon2 et la signature JWT sont reels. Le token public est un VRAI token
 * genere par le code de production et son empreinte est calculee par la vraie
 * fonction de hachage : un test qui utiliserait une empreinte inventee ne
 * verifierait pas que la recherche par empreinte fonctionne.
 */
describe('DepositAccessService — lien public et PIN', () => {
  let pinHash: string;

  beforeAll(async () => {
    pinHash = await argon2.hash(PIN, { type: argon2.argon2id });
  });

  function build(overrides: Parameters<typeof depositRequest>[2] = {}) {
    const token = generateAccessToken();
    const demande = depositRequest(REQUEST_A, LAWYER_A, {
      tokenHash: hashAccessToken(token),
      pinHash,
      ...overrides,
    });

    const { prisma, store, calls } = createFakePrisma({
      lawyers: [lawyer(LAWYER_A, { displayName: 'Maitre Amar Idinarene' })],
      requests: [demande],
    });

    const jwt = new JwtService({
      secret: SECRET_DEPOT,
      signOptions: { expiresIn: '30m', audience: DEPOSIT_TOKEN_AUDIENCE },
    });

    const { metrics, recorded } = fakeMetrics();
    const service = new DepositAccessService(
      prisma,
      jwt,
      fakeConfig({ PIN_MAX_ATTEMPTS: MAX_TENTATIVES, PIN_LOCK_MINUTES: 15 }),
      metrics,
    );

    return { service, token, store, calls, recorded, jwt, demande: () => store.requests[0] };
  }

  describe('resolution du lien avant saisie du code', () => {
    it('renvoie les metadonnees d affichage et RIEN de plus', async () => {
      const { service, token } = build({ instructions: 'Merci de joindre les trois avis.' });

      const vue = await service.resolve(token);

      // Le contenu exact importe : cette reponse est servie a un inconnu, avant
      // toute authentification. Un identifiant technique ici permettrait de
      // remonter a la demande par un autre chemin.
      expect(Object.keys(vue).sort()).toEqual([
        'clientName',
        'expiresAt',
        'instructions',
        'lawyerName',
        'title',
      ]);
      const serialise = JSON.stringify(vue);
      expect(serialise).not.toContain(REQUEST_A);
      expect(serialise).not.toContain(LAWYER_A);
      expect(serialise).not.toContain(pinHash);
      expect(serialise).not.toContain(hashAccessToken(token));
    });

    it('refuse un token malforme SANS interroger la base', async () => {
      // Le filtre en amont evite de faire travailler la base pour chaque sonde
      // d un scanner. Le compteur d appels le prouve.
      const { service, calls } = build();

      for (const invalide of ['', 'trop-court', 'a'.repeat(44), 'contient/des+caracteres=']) {
        await expect(service.resolve(invalide)).rejects.toBeInstanceOf(NotFoundException);
      }
      expect(calls.depositRequestFindUnique).toBe(0);
    });

    it('refuse un token bien forme mais inconnu', async () => {
      const { service } = build();
      await expect(service.resolve(generateAccessToken())).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('refuse un lien expire', async () => {
      const { service, token } = build({ expiresAt: new Date(Date.now() - 1000) });
      await expect(service.resolve(token)).rejects.toBeInstanceOf(NotFoundException);
    });

    it('refuse un lien deja soumis', async () => {
      const { service, token } = build({ status: 'SUBMITTED', submittedAt: new Date() });
      await expect(service.resolve(token)).rejects.toBeInstanceOf(NotFoundException);
    });

    it('refuse un lien cloture par l avocat', async () => {
      const { service, token } = build({ status: 'CLOSED' });
      await expect(service.resolve(token)).rejects.toBeInstanceOf(NotFoundException);
    });

    it('repond exactement la meme chose dans les cinq cas de refus', async () => {
      // Propriete de securite explicitement demandee : les erreurs ne revelent
      // pas si une demande existe. Un message different pour « expire » et pour
      // « inconnu » suffirait a valider un token vole apres echeance.

      /** Capture la reponse d erreur, et echoue si l appel a reussi. */
      async function refus(operation: Promise<unknown>): Promise<string> {
        try {
          await operation;
        } catch (erreur) {
          return JSON.stringify((erreur as { getResponse(): unknown }).getResponse());
        }
        throw new Error('l acces aurait du etre refuse');
      }

      const malforme = build();
      const inconnu = build();
      const expire = build({ expiresAt: new Date(Date.now() - 1000) });
      const soumis = build({ status: 'SUBMITTED' });
      const cloture = build({ status: 'CLOSED' });

      const reponses = [
        await refus(malforme.service.resolve('nawak')),
        await refus(inconnu.service.resolve(generateAccessToken())),
        await refus(expire.service.resolve(expire.token)),
        await refus(soumis.service.resolve(soumis.token)),
        await refus(cloture.service.resolve(cloture.token)),
      ];

      expect(new Set(reponses).size).toBe(1);
    });
  });

  describe('verification du code', () => {
    it('ouvre une session sur le bon code', async () => {
      const { service, token, jwt, recorded } = build();

      const resultat = await service.verifyPin(token, PIN);

      // Le token de session est reellement verifiable par la garde de
      // production, avec la bonne audience et le bon scope.
      const charge = await jwt.verifyAsync<{ sub: string; scope: string; aud: string }>(
        resultat.token,
        { secret: SECRET_DEPOT, audience: DEPOSIT_TOKEN_AUDIENCE },
      );
      expect(charge.sub).toBe(REQUEST_A);
      expect(charge.scope).toBe('deposit');
      expect(resultat.expiresAt.getTime()).toBeGreaterThan(Date.now());
      // La reponse porte aussi les metadonnees d affichage.
      expect(resultat.deposit.title).toBe('Pieces justificatives');
      expect(recorded).toContain('pin.success');
    });

    it('refuse un mauvais code et decompte les tentatives restantes', async () => {
      const { service, token, demande } = build();

      const erreur = await service.verifyPin(token, '999999').catch((e) => e);

      expect(erreur).toBeInstanceOf(UnauthorizedException);
      expect(erreur.getResponse()).toEqual({
        message: 'Code invalide.',
        attemptsLeft: MAX_TENTATIVES - 1,
      });
      // Le compteur est PERSISTE : un redemarrage de l API ne l effacerait pas.
      expect(demande().failedAttempts).toBe(1);
    });

    it('decompte tentative apres tentative', async () => {
      const { service, token, demande } = build();

      for (let essai = 1; essai < MAX_TENTATIVES; essai += 1) {
        const erreur = await service.verifyPin(token, '000000').catch((e) => e);
        expect(erreur.getResponse().attemptsLeft).toBe(MAX_TENTATIVES - essai);
        expect(demande().failedAttempts).toBe(essai);
        expect(demande().lockedUntil).toBeNull();
      }
    });

    it('verrouille la demande a la derniere tentative', async () => {
      const { service, token, demande } = build({ failedAttempts: MAX_TENTATIVES - 1 });

      const erreur = await service.verifyPin(token, '000000').catch((e) => e);

      expect(erreur.getResponse().attemptsLeft).toBe(0);
      expect(demande().lockedUntil).toBeInstanceOf(Date);
      expect(demande().lockedUntil!.getTime()).toBeGreaterThan(Date.now());
      // Le compteur repart de zero : apres expiration du blocage, le client
      // dispose d une serie complete plutot que d etre bloque a vie.
      expect(demande().failedAttempts).toBe(0);
    });

    it('refuse pendant le verrouillage, MEME avec le bon code', async () => {
      // Point essentiel : si le bon code passait pendant le blocage, le
      // verrouillage ne servirait a rien contre un attaquant qui finit par
      // trouver.
      const { service, token, recorded } = build({
        lockedUntil: new Date(Date.now() + 15 * 60_000),
      });

      const erreur = await service.verifyPin(token, PIN).catch((e) => e);

      expect(erreur).toBeInstanceOf(ForbiddenException);
      expect(erreur.getResponse().retryAfterSeconds).toBeGreaterThan(0);
      expect(erreur.getResponse().retryAfterSeconds).toBeLessThanOrEqual(15 * 60);
      expect(recorded).toContain('pin.locked');
      expect(recorded).not.toContain('pin.success');
    });

    it('accepte a nouveau une fois le verrou echu', async () => {
      // L expiration du verrou est une COMPARAISON de dates, pas une tache
      // planifiee : rien n a besoin de tourner pour que le blocage se leve.
      const { service, token } = build({ lockedUntil: new Date(Date.now() - 1000) });

      await expect(service.verifyPin(token, PIN)).resolves.toBeDefined();
    });

    it('remet les compteurs a zero apres une reussite', async () => {
      const { service, token, demande } = build({
        failedAttempts: 3,
        lockedUntil: new Date(Date.now() - 1000),
      });

      await service.verifyPin(token, PIN);

      expect(demande().failedAttempts).toBe(0);
      expect(demande().lockedUntil).toBeNull();
    });

    it('n ouvre aucune session sur un lien expire, meme avec le bon code', async () => {
      const { service, token } = build({ expiresAt: new Date(Date.now() - 1000) });

      // 404 et non 401 : la reponse est celle d un lien inexistant.
      await expect(service.verifyPin(token, PIN)).rejects.toBeInstanceOf(NotFoundException);
    });

    it('n ouvre aucune session apres soumission, meme avec le bon code', async () => {
      const { service, token } = build({ status: 'SUBMITTED', submittedAt: new Date() });

      await expect(service.verifyPin(token, PIN)).rejects.toBeInstanceOf(NotFoundException);
    });

    it('ne consomme pas de tentative quand le lien est de toute facon ferme', async () => {
      // Sinon un scanner pourrait epuiser les essais d une demande cloturee, et
      // surtout distinguer par effet de bord un lien connu d un lien inconnu.
      const { service, token, demande } = build({ status: 'CLOSED' });

      await service.verifyPin(token, '000000').catch(() => undefined);

      expect(demande().failedAttempts).toBe(0);
    });

    it('traite un pinHash corrompu comme un code invalide, pas comme une erreur 500', async () => {
      const { service, token } = build({ pinHash: 'pas-un-hash-argon2' });

      await expect(service.verifyPin(token, PIN)).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it('ne divulgue jamais le code ni les empreintes dans la reponse d erreur', async () => {
      const { service, token } = build();

      const erreur = await service.verifyPin(token, '111111').catch((e) => e);
      const serialise = JSON.stringify(erreur.getResponse());

      expect(serialise).not.toContain(PIN);
      expect(serialise).not.toContain(pinHash);
    });
  });

  describe('session liee a UNE demande', () => {
    it('refuse une session dont la demande a ete soumise entre-temps', async () => {
      // La garde valide le token, mais la demande a change d etat depuis
      // l emission : le service reverifie systematiquement.
      const { service, store } = build();

      store.requests[0].status = 'SUBMITTED';

      await expect(
        service.getSessionDeposit(REQUEST_A, new Date(Date.now() + 60_000)),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('refuse une session dont le lien a expire depuis l emission', async () => {
      // Une session de 30 min emise juste avant l echeance du lien ne doit pas
      // survivre au lien lui-meme.
      const { service, store } = build();

      store.requests[0].expiresAt = new Date(Date.now() - 1000);

      await expect(
        service.getSessionDeposit(REQUEST_A, new Date(Date.now() + 60_000)),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('ne donne acces a aucune autre demande que la sienne', async () => {
      // Le magasin ne contient QUE la demande A : une session forgee pour une
      // autre demande ne trouve rien. Le service n a aucun chemin de code qui
      // ignore l identifiant de session.
      const { service } = build();

      await expect(
        service.getSessionDeposit('99999999-9999-4999-8999-999999999999', new Date()),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('ne soumet jamais une demande autre que celle de la session', async () => {
      // Les tests de submit existants (deposit-access.service.spec.ts) portent
      // sur les REGLES de transition avec un double simple. Ici le magasin
      // contient reellement la demande A : une session forgee pour une autre
      // demande ne trouve rien et ne peut donc rien soumettre.
      const { service, store } = build({ status: 'IN_PROGRESS' });
      store.documents.push({ id: 'd1', requestId: REQUEST_A, status: 'AVAILABLE' } as never);

      await expect(
        service.submit('99999999-9999-4999-8999-999999999999'),
      ).rejects.toBeInstanceOf(NotFoundException);
      // La demande legitime n a pas bouge d un iota.
      expect(store.requests[0].status).toBe('IN_PROGRESS');
      expect(store.requests[0].submittedAt).toBeNull();

      // ... alors que la sienne se soumet normalement.
      await expect(service.submit(REQUEST_A)).resolves.toMatchObject({ status: 'SUBMITTED' });
    });

    it('expose l etat de la demande et le compte de pieces disponibles', async () => {
      const { service } = build({ status: 'IN_PROGRESS' });
      const sessionExpiresAt = new Date(Date.now() + 60_000);

      const vue = await service.getSessionDeposit(REQUEST_A, sessionExpiresAt);

      expect(vue.status).toBe('IN_PROGRESS');
      expect(vue.documentsCount).toBe(0);
      expect(vue.sessionExpiresAt).toBe(sessionExpiresAt);
      expect(vue.lawyerName).toBe('Maitre Amar Idinarene');
      // Toujours aucun identifiant technique cote client.
      expect(JSON.stringify(vue)).not.toContain(REQUEST_A);
    });
  });
});
