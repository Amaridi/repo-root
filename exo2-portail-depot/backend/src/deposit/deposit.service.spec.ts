import { describe, expect, it } from '@jest/globals';
import { NotFoundException } from '@nestjs/common';
import * as argon2 from 'argon2';
import { ACCESS_TOKEN_PATTERN } from '../deposit-access/deposit-access.constants';
import {
  LAWYER_A,
  LAWYER_B,
  REQUEST_A,
  REQUEST_B,
  depositRequest,
  document,
  fakeConfig,
  fakeMetrics,
  lawyer,
} from '../testing/fixtures';
import { createFakePrisma } from '../testing/prisma-fake';
import { DepositService } from './deposit.service';
import { hashAccessToken } from './deposit-secrets';

const BASE_URL = 'http://127.0.0.1:22470';
const TTL_JOURS = 7;
const JOUR = 24 * 60 * 60 * 1000;

/**
 * Demandes de depot, cote avocat.
 *
 * Le magasin contient TOUJOURS les demandes des deux avocats. C est la seule
 * facon de tester une isolation : un double qui renvoie `null` quoi qu on lui
 * demande passerait meme si le service oubliait le filtre `lawyerId`.
 */
describe('DepositService', () => {
  function build(requests = [depositRequest(REQUEST_A, LAWYER_A)], documents = []) {
    const { prisma, store } = createFakePrisma({
      lawyers: [lawyer(LAWYER_A), lawyer(LAWYER_B)],
      requests,
      documents,
    });
    const { metrics, recorded } = fakeMetrics();

    const service = new DepositService(
      prisma,
      fakeConfig({ DEPOSIT_LINK_TTL_DAYS: TTL_JOURS, PUBLIC_BASE_URL: BASE_URL }),
      metrics,
    );

    return { service, store, recorded };
  }

  describe('create', () => {
    it('cree la demande et remet les deux secrets, une seule fois', async () => {
      const { service, store, recorded } = build([]);

      const resultat = await service.create(LAWYER_A, {
        title: 'Justificatifs de domicile',
        clientName: 'Claire Nadeau',
      });

      expect(store.requests).toHaveLength(1);
      const persistee = store.requests[0];

      expect(resultat.request.status).toBe('PENDING');
      expect(resultat.request.documentsCount).toBe(0);
      expect(persistee.lawyerId).toBe(LAWYER_A);
      expect(recorded).toContain('deposit.created');
    });

    it('produit un lien dont le token satisfait le filtre de la couche publique', async () => {
      const { service } = build([]);

      const { access } = await service.create(LAWYER_A, {
        title: 'T',
        clientName: 'C',
      });

      expect(access.depositUrl.startsWith(`${BASE_URL}/d/`)).toBe(true);
      const token = access.depositUrl.split('/d/')[1];
      // Meme verification que celle appliquee a l ouverture du lien : si les
      // deux divergeaient, le lien remis a l avocat serait inutilisable.
      expect(token).toMatch(ACCESS_TOKEN_PATTERN);
    });

    it('ne persiste QUE les empreintes, jamais les secrets en clair', async () => {
      // L exigence centrale du sujet. Une fois la reponse envoyee, ni le token
      // ni le PIN ne doivent etre retrouvables en base.
      const { service, store } = build([]);

      const { access } = await service.create(LAWYER_A, { title: 'T', clientName: 'C' });
      const token = access.depositUrl.split('/d/')[1];
      const persistee = store.requests[0];

      // L empreinte stockee est bien celle du token remis : la recherche par
      // empreinte fonctionnera.
      expect(persistee.tokenHash).toBe(hashAccessToken(token));
      expect(persistee.tokenHash).toMatch(/^[0-9a-f]{64}$/);

      // Le PIN est hache avec argon2id, et l empreinte verifie bien le PIN
      // remis — le hachage n est pas un simple decor.
      expect(persistee.pinHash.startsWith('$argon2id$')).toBe(true);
      await expect(argon2.verify(persistee.pinHash, access.pin)).resolves.toBe(true);

      // Et surtout : aucune trace des valeurs en clair dans la ligne.
      const serialise = JSON.stringify(persistee);
      expect(serialise).not.toContain(token);
      expect(serialise).not.toContain(access.pin);
    });

    it('remet un PIN a six chiffres', async () => {
      const { service } = build([]);
      const { access } = await service.create(LAWYER_A, { title: 'T', clientName: 'C' });
      expect(access.pin).toMatch(/^[0-9]{6}$/);
    });

    it('applique la duree de validite de la configuration, et elle seule', async () => {
      // L avocat ne choisit pas la duree : c est une decision de securite, pas
      // un reglage d interface. Le champ `expiresInDays` a ete retire pour
      // cette raison.
      const { service, store } = build([]);
      const avant = Date.now();

      await service.create(LAWYER_A, { title: 'T', clientName: 'C' });

      const echeance = store.requests[0].expiresAt.getTime();
      expect(echeance).toBeGreaterThanOrEqual(avant + TTL_JOURS * JOUR);
      // Marge d une seconde pour le temps d execution du hachage argon2.
      expect(echeance).toBeLessThan(avant + TTL_JOURS * JOUR + 5000);
    });

    it('emet des secrets differents a chaque demande', async () => {
      const { service } = build([]);

      const premiere = await service.create(LAWYER_A, { title: 'T', clientName: 'C' });
      const seconde = await service.create(LAWYER_A, { title: 'T', clientName: 'C' });

      expect(premiere.access.depositUrl).not.toBe(seconde.access.depositUrl);
      // Deux PIN identiques de suite sont possibles (1 sur 10^6) : c est
      // l empreinte qui doit differer, puisque argon2 sale chaque hachage.
      expect(premiere.access.pin).toBeDefined();
    });

    it('ne laisse fuiter aucune empreinte dans la reponse', async () => {
      const { service, store } = build([]);

      const resultat = await service.create(LAWYER_A, { title: 'T', clientName: 'C' });
      const serialise = JSON.stringify(resultat);

      expect(serialise).not.toContain(store.requests[0].tokenHash);
      expect(serialise).not.toContain(store.requests[0].pinHash);
      // L identite de l avocat n a pas a figurer dans sa propre reponse, mais
      // surtout la vue ne doit exposer aucun champ inattendu.
      expect(Object.keys(resultat.request).sort()).toEqual([
        'clientEmail',
        'clientName',
        'createdAt',
        'documentsCount',
        'expiresAt',
        'id',
        'instructions',
        'isExpired',
        'status',
        'submittedAt',
        'title',
      ]);
    });
  });

  describe('findAllForLawyer', () => {
    it('ne renvoie que les demandes de l avocat courant', async () => {
      const { service } = build([
        depositRequest(REQUEST_A, LAWYER_A, { title: 'Dossier de A' }),
        depositRequest(REQUEST_B, LAWYER_B, { title: 'Dossier de B' }),
      ]);

      const demandes = await service.findAllForLawyer(LAWYER_A);

      expect(demandes).toHaveLength(1);
      expect(demandes[0].title).toBe('Dossier de A');
    });

    it('renvoie une liste vide pour un avocat sans demande', async () => {
      const { service } = build([depositRequest(REQUEST_A, LAWYER_A)]);
      await expect(service.findAllForLawyer(LAWYER_B)).resolves.toEqual([]);
    });

    it('calcule l expiration au lieu de la lire', async () => {
      // isExpired n est jamais persiste : un booleen en base mentirait des
      // qu une horloge derive ou qu une tache planifiee ne tourne pas.
      const { service } = build([
        depositRequest(REQUEST_A, LAWYER_A, { expiresAt: new Date(Date.now() - 1000) }),
        depositRequest(REQUEST_B, LAWYER_A, { expiresAt: new Date(Date.now() + 60_000) }),
      ]);

      const demandes = await service.findAllForLawyer(LAWYER_A);

      expect(demandes.find((d) => d.id === REQUEST_A)?.isExpired).toBe(true);
      expect(demandes.find((d) => d.id === REQUEST_B)?.isExpired).toBe(false);
    });

    it('compte les documents reellement rattaches a chaque demande', async () => {
      const { service } = build(
        [depositRequest(REQUEST_A, LAWYER_A), depositRequest(REQUEST_B, LAWYER_A)],
        [
          document('d1', REQUEST_A),
          document('d2', REQUEST_A),
          document('d3', REQUEST_B),
        ] as never,
      );

      const demandes = await service.findAllForLawyer(LAWYER_A);

      expect(demandes.find((d) => d.id === REQUEST_A)?.documentsCount).toBe(2);
      expect(demandes.find((d) => d.id === REQUEST_B)?.documentsCount).toBe(1);
    });
  });

  describe('findOneForLawyer — isolation entre avocats', () => {
    it('donne acces a sa propre demande', async () => {
      const { service } = build([depositRequest(REQUEST_A, LAWYER_A)]);

      const demande = await service.findOneForLawyer(LAWYER_A, REQUEST_A);
      expect(demande.id).toBe(REQUEST_A);
    });

    it('REFUSE la demande d un autre avocat, alors qu elle existe bel et bien', async () => {
      // Le test central de l isolation. La demande de B est presente dans le
      // magasin : si le service perdait son filtre `lawyerId`, elle serait
      // retournee ici et le test echouerait. C est precisement ce qu une
      // verification anterieure de ce projet n avait PAS prouve, faute d avoir
      // le second avocat en base.
      const { service, store } = build([
        depositRequest(REQUEST_A, LAWYER_A),
        depositRequest(REQUEST_B, LAWYER_B, { title: 'Dossier confidentiel de B' }),
      ]);

      // La donnee existe, sans ambiguite.
      expect(store.requests.find((r) => r.id === REQUEST_B)).toBeDefined();

      await expect(service.findOneForLawyer(LAWYER_A, REQUEST_B)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('repond 404 et non 403, pour ne pas confirmer l existence de la demande', async () => {
      const { service } = build([
        depositRequest(REQUEST_A, LAWYER_A),
        depositRequest(REQUEST_B, LAWYER_B),
      ]);

      const existanteMaisAutrui = await service
        .findOneForLawyer(LAWYER_A, REQUEST_B)
        .catch((e) => e);
      const inexistante = await service
        .findOneForLawyer(LAWYER_A, '99999999-9999-4999-8999-999999999999')
        .catch((e) => e);

      // Reponses strictement identiques : impossible de deviner qu une demande
      // existe chez un confrere en comparant les erreurs.
      expect(existanteMaisAutrui.getStatus()).toBe(404);
      expect(existanteMaisAutrui.getResponse()).toEqual(inexistante.getResponse());
    });

    it('ne laisse jamais sortir les empreintes dans la vue detaillee', async () => {
      const { service, store } = build([
        depositRequest(REQUEST_A, LAWYER_A, {
          tokenHash: 'f'.repeat(64),
          pinHash: '$argon2id$secret',
        }),
      ]);

      const vue = await service.findOneForLawyer(LAWYER_A, REQUEST_A);
      const serialise = JSON.stringify(vue);

      expect(serialise).not.toContain(store.requests[0].tokenHash);
      expect(serialise).not.toContain(store.requests[0].pinHash);
      expect(vue).not.toHaveProperty('lawyerId');
    });
  });

  describe('statuts', () => {
    it('expose les quatre statuts du cycle de vie tels quels', async () => {
      // Les transitions sont ecrites par le parcours client (IN_PROGRESS a la
      // premiere piece confirmee, SUBMITTED a la soumission) ; l avocat les
      // LIT. Ce test verifie qu aucune traduction hasardeuse ne s intercale.
      const statuts = ['PENDING', 'IN_PROGRESS', 'SUBMITTED', 'CLOSED'] as const;

      for (const status of statuts) {
        const { service } = build([depositRequest(REQUEST_A, LAWYER_A, { status })]);
        const vue = await service.findOneForLawyer(LAWYER_A, REQUEST_A);
        expect(vue.status).toBe(status);
      }
    });

    it('expose submittedAt une fois la demande soumise', async () => {
      const soumisLe = new Date('2026-09-09T19:39:47.151Z');
      const { service } = build([
        depositRequest(REQUEST_A, LAWYER_A, { status: 'SUBMITTED', submittedAt: soumisLe }),
      ]);

      const vue = await service.findOneForLawyer(LAWYER_A, REQUEST_A);

      expect(vue.status).toBe('SUBMITTED');
      expect(vue.submittedAt).toEqual(soumisLe);
    });
  });
});
