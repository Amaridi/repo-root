import { describe, expect, it } from '@jest/globals';
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { DepositAccessService } from '../deposit-access/deposit-access.service';
import {
  DOCUMENT_A,
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
import { createFakeStorage } from '../testing/storage-fake';
import { DocumentsService } from './documents.service';

const MAX_OCTETS = 25 * 1024 * 1024;
const MAX_FICHIERS = 10;

/**
 * Cycle de vie d un document : autorisation, confirmation, consultation.
 *
 * Deux choix de conception de ces tests :
 *
 * 1. Le VRAI DepositAccessService est utilise, pas un double. C est lui qui
 *    porte la regle « la demande est-elle encore ouverte ? », et cette regle est
 *    justement ce qu il faut verifier a chaque ecriture. La mocker reviendrait a
 *    supposer ce qu on veut prouver.
 * 2. Le stockage est double, mais il RETIENT ce qu on y depose, avec une taille
 *    et un type reels. C est ce qui permet de simuler un client qui annonce un
 *    PDF de 1 ko et envoie 40 Mo de texte — le cas que la confirmation existe
 *    pour attraper.
 */
describe('DocumentsService', () => {
  function build({
    requests = [depositRequest(REQUEST_A, LAWYER_A)],
    documents = [] as ReturnType<typeof document>[],
  } = {}) {
    const { prisma, store } = createFakePrisma({
      lawyers: [lawyer(LAWYER_A), lawyer(LAWYER_B)],
      requests,
      documents,
    });
    const { storage, put, removed } = createFakeStorage();
    const { metrics, recorded } = fakeMetrics();

    const config = fakeConfig({
      UPLOAD_MAX_BYTES: MAX_OCTETS,
      UPLOAD_MAX_FILES_PER_REQUEST: MAX_FICHIERS,
      PIN_MAX_ATTEMPTS: 5,
      PIN_LOCK_MINUTES: 15,
    });

    const depositAccess = new DepositAccessService(
      prisma,
      new JwtService({ secret: 'secret-de-test-suffisamment-long' }),
      config,
      metrics,
    );

    const service = new DocumentsService(prisma, storage, depositAccess, config, metrics);

    return { service, store, put, removed, recorded, depositAccess };
  }

  const pdf = { filename: 'avis.pdf', mimeType: 'application/pdf', sizeBytes: 40_194 };

  describe('requestUpload — autorisation de depot', () => {
    it('enregistre une ligne PENDING et renvoie une URL signee', async () => {
      const { service, store } = build();

      const ticket = await service.requestUpload(REQUEST_A, pdf);

      expect(store.documents).toHaveLength(1);
      const ligne = store.documents[0];
      // PENDING : la ligne existe, les octets ne sont pas encore garantis.
      expect(ligne.status).toBe('PENDING');
      expect(ligne.requestId).toBe(REQUEST_A);
      expect(ligne.originalName).toBe('avis.pdf');
      expect(ticket.documentId).toBe(ligne.id);
      expect(ticket.requiredHeaders).toEqual({ 'Content-Type': 'application/pdf' });
      expect(ticket.expiresAt.getTime()).toBeGreaterThan(Date.now());
    });

    it('n expose jamais la cle de stockage ni un identifiant MinIO au client', async () => {
      const { service, store } = build();

      const ticket = await service.requestUpload(REQUEST_A, pdf);
      const serialise = JSON.stringify(ticket);

      // L URL signee contient forcement la cle ; ce qui ne doit pas fuiter,
      // c est un identifiant d acces au stockage.
      expect(serialise).not.toContain('S3_ACCESS_KEY');
      expect(serialise).not.toContain('secret');
      // La cle n est pas exposee comme champ exploitable de la reponse.
      expect(ticket).not.toHaveProperty('storageKey');
      expect(store.documents[0].storageKey.startsWith(`deposits/${REQUEST_A}/`)).toBe(true);
    });

    it('range l objet sous le prefixe de SA demande', async () => {
      // Consequence directe : un client ne peut pas ecrire dans l espace d une
      // autre demande, meme en choisissant son nom de fichier.
      const { service, store } = build();

      await service.requestUpload(REQUEST_A, { ...pdf, filename: '../../vol.pdf' });

      expect(store.documents[0].storageKey.startsWith(`deposits/${REQUEST_A}/`)).toBe(true);
      expect(store.documents[0].storageKey).not.toContain('..');
    });

    it('refuse un type de fichier non autorise, en donnant la raison', async () => {
      const { service, store } = build();

      const erreur = await service
        .requestUpload(REQUEST_A, {
          filename: 'charge.zip',
          mimeType: 'application/zip',
          sizeBytes: 1024,
        })
        .catch((e) => e);

      expect(erreur).toBeInstanceOf(BadRequestException);
      expect(erreur.getResponse().reason).toBe('MIME_NOT_ALLOWED');
      // Aucune ligne ne doit rester derriere un refus.
      expect(store.documents).toHaveLength(0);
    });

    it('refuse une extension incoherente avec le type annonce', async () => {
      const { service } = build();

      const erreur = await service
        .requestUpload(REQUEST_A, {
          filename: 'charge.exe',
          mimeType: 'application/pdf',
          sizeBytes: 1024,
        })
        .catch((e) => e);

      expect(erreur.getResponse().reason).toBe('EXTENSION_MISMATCH');
    });

    it('refuse une taille annoncee hors gabarit', async () => {
      const { service } = build();

      const trop = await service
        .requestUpload(REQUEST_A, { ...pdf, sizeBytes: MAX_OCTETS + 1 })
        .catch((e) => e);
      expect(trop.getResponse().reason).toBe('TOO_LARGE');

      const vide = await service.requestUpload(REQUEST_A, { ...pdf, sizeBytes: 0 }).catch((e) => e);
      expect(vide.getResponse().reason).toBe('EMPTY');
    });

    it('plafonne le nombre de pieces par demande', async () => {
      const dejaLa = Array.from({ length: MAX_FICHIERS }, (_, i) =>
        document(`doc-${i}`, REQUEST_A),
      );
      const { service } = build({ documents: dejaLa });

      await expect(service.requestUpload(REQUEST_A, pdf)).rejects.toBeInstanceOf(ConflictException);
    });

    it('compte AUSSI les lignes PENDING dans le plafond', async () => {
      // Sinon le plafond serait contournable en demandant mille autorisations
      // sans jamais confirmer : mille lignes, et autant d objets orphelins.
      const dejaLa = Array.from({ length: MAX_FICHIERS }, (_, i) =>
        document(`doc-${i}`, REQUEST_A, { status: 'PENDING', confirmedAt: null }),
      );
      const { service } = build({ documents: dejaLa });

      await expect(service.requestUpload(REQUEST_A, pdf)).rejects.toBeInstanceOf(ConflictException);
    });

    it('refuse toute autorisation sur une demande fermee', async () => {
      for (const overrides of [
        { status: 'SUBMITTED' as const },
        { status: 'CLOSED' as const },
        { expiresAt: new Date(Date.now() - 1000) },
      ]) {
        const { service, store } = build({
          requests: [depositRequest(REQUEST_A, LAWYER_A, overrides)],
        });

        await expect(service.requestUpload(REQUEST_A, pdf)).rejects.toBeInstanceOf(
          NotFoundException,
        );
        expect(store.documents).toHaveLength(0);
      }
    });
  });

  describe('confirmUpload — le moment ou la ligne cesse d etre une promesse', () => {
    it('refuse la confirmation si AUCUN objet n est arrive', async () => {
      // Sans cette verification, la liste de l avocat contiendrait des documents
      // fantomes : la ligne existe des l autorisation, les octets peuvent ne
      // jamais arriver.
      const { service, store, recorded } = build();
      const ticket = await service.requestUpload(REQUEST_A, pdf);

      await expect(service.confirmUpload(REQUEST_A, ticket.documentId)).rejects.toBeInstanceOf(
        BadRequestException,
      );

      expect(store.documents[0].status).toBe('PENDING');
      expect(recorded).toContain('upload.failed');
      // La demande n a pas bouge : rien n a ete depose.
      expect(store.requests[0].status).toBe('PENDING');
    });

    it('confirme, enregistre la taille REELLE, et fait passer la demande en cours', async () => {
      const { service, store, put, recorded } = build();
      const ticket = await service.requestUpload(REQUEST_A, { ...pdf, sizeBytes: 1 });
      const cle = store.documents[0].storageKey;

      // Le client a annonce 1 octet et envoie 40 194 : c est la valeur du
      // stockage qui doit etre retenue, pas la declaration.
      put(cle, 40_194, 'application/pdf');

      const vue = await service.confirmUpload(REQUEST_A, ticket.documentId);

      expect(vue.status).toBe('AVAILABLE');
      expect(vue.sizeBytes).toBe(40_194);
      expect(store.documents[0].confirmedAt).toBeInstanceOf(Date);
      // Premiere piece confirmee : PENDING -> IN_PROGRESS.
      expect(store.requests[0].status).toBe('IN_PROGRESS');
      expect(recorded).toContain('upload.confirmed');
    });

    it('supprime l objet ET la ligne quand la taille reelle est hors gabarit', async () => {
      // Une URL presignee en PUT ne permet pas d imposer une borne de taille,
      // contrairement a une policy POST. Le nettoyage a posteriori est donc la
      // seule protection : sans lui, le bucket accumulerait les depots abusifs.
      const { service, store, put, removed, recorded } = build();
      const ticket = await service.requestUpload(REQUEST_A, pdf);
      const cle = store.documents[0].storageKey;

      put(cle, MAX_OCTETS + 1, 'application/pdf');

      await expect(service.confirmUpload(REQUEST_A, ticket.documentId)).rejects.toBeInstanceOf(
        BadRequestException,
      );

      expect(removed).toContain(cle);
      expect(store.documents).toHaveLength(0);
      expect(recorded).toContain('upload.rejected');
      expect(store.requests[0].status).toBe('PENDING');
    });

    it('supprime l objet ET la ligne quand le type reel ne correspond pas', async () => {
      // Constate en conditions reelles : une URL presignee en PUT ne contraint
      // pas les en-tetes envoyes. Un depot annonce en application/pdf peut
      // arriver en text/plain. Seule la valeur rapportee par le stockage est
      // digne de confiance.
      const { service, store, put, removed, recorded } = build();
      const ticket = await service.requestUpload(REQUEST_A, pdf);
      const cle = store.documents[0].storageKey;

      put(cle, 40_194, 'text/plain');

      const erreur = await service.confirmUpload(REQUEST_A, ticket.documentId).catch((e) => e);

      expect(erreur).toBeInstanceOf(BadRequestException);
      expect(erreur.getResponse().message).toContain('text/plain');
      expect(removed).toContain(cle);
      expect(store.documents).toHaveLength(0);
      expect(recorded).toContain('upload.rejected');
    });

    it('accepte un objet dont le stockage ne rapporte aucun type', async () => {
      // Cas limite reel : certains stockages ne renvoient pas Content-Type. Le
      // service ne doit pas rejeter faute d information — la taille et la liste
      // blanche declaree restent verifiees.
      const { service, store, put } = build();
      const ticket = await service.requestUpload(REQUEST_A, pdf);

      put(store.documents[0].storageKey, 40_194, undefined);

      await expect(service.confirmUpload(REQUEST_A, ticket.documentId)).resolves.toMatchObject({
        status: 'AVAILABLE',
      });
    });

    it('est idempotente : confirmer deux fois ne change rien', async () => {
      const { service, store, put } = build();
      const ticket = await service.requestUpload(REQUEST_A, pdf);
      put(store.documents[0].storageKey, 40_194, 'application/pdf');

      const premiere = await service.confirmUpload(REQUEST_A, ticket.documentId);
      const seconde = await service.confirmUpload(REQUEST_A, ticket.documentId);

      expect(seconde.confirmedAt).toEqual(premiere.confirmedAt);
      expect(seconde.sizeBytes).toBe(premiere.sizeBytes);
    });

    it('ne confirme pas un document appartenant a une AUTRE demande', async () => {
      // Isolation entre deux clients : la session porte l identifiant de sa
      // demande, et l identifiant du document seul ne suffit pas.
      const { service } = build({
        requests: [depositRequest(REQUEST_A, LAWYER_A), depositRequest(REQUEST_B, LAWYER_B)],
        documents: [document(DOCUMENT_A, REQUEST_B, { status: 'PENDING', confirmedAt: null })],
      });

      await expect(service.confirmUpload(REQUEST_A, DOCUMENT_A)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('refuse toute confirmation sur une demande fermee entre-temps', async () => {
      const { service, store, put } = build();
      const ticket = await service.requestUpload(REQUEST_A, pdf);
      put(store.documents[0].storageKey, 40_194, 'application/pdf');

      // Le client a soumis dans un autre onglet, ou l avocat a cloture.
      store.requests[0].status = 'SUBMITTED';

      await expect(service.confirmUpload(REQUEST_A, ticket.documentId)).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(store.documents[0].status).toBe('PENDING');
    });

    it('ne fait pas reculer un statut deja avance', async () => {
      // La transition PENDING -> IN_PROGRESS est ecrite par un updateMany qui
      // porte le statut dans son WHERE : elle ne peut donc pas ecraser un
      // SUBMITTED ou un CLOSED pose entre-temps.
      const { service, store, put } = build({
        requests: [depositRequest(REQUEST_A, LAWYER_A, { status: 'IN_PROGRESS' })],
      });
      const ticket = await service.requestUpload(REQUEST_A, pdf);
      put(store.documents[0].storageKey, 40_194, 'application/pdf');

      await service.confirmUpload(REQUEST_A, ticket.documentId);

      expect(store.requests[0].status).toBe('IN_PROGRESS');
    });
  });

  describe('listForDeposit — vue du client', () => {
    it('ne montre que les pieces confirmees de SA demande', async () => {
      const { service } = build({
        requests: [depositRequest(REQUEST_A, LAWYER_A), depositRequest(REQUEST_B, LAWYER_B)],
        documents: [
          document('a-dispo', REQUEST_A),
          document('a-en-attente', REQUEST_A, { status: 'PENDING', confirmedAt: null }),
          document('b-dispo', REQUEST_B),
        ],
      });

      const pieces = await service.listForDeposit(REQUEST_A);

      // Une seule : ni la ligne PENDING (octets non garantis), ni la piece de
      // l autre demande.
      expect(pieces.map((p) => p.id)).toEqual(['a-dispo']);
    });

    it('n expose pas la cle de stockage', async () => {
      const { service } = build({ documents: [document(DOCUMENT_A, REQUEST_A)] });

      const [piece] = await service.listForDeposit(REQUEST_A);

      expect(piece).not.toHaveProperty('storageKey');
      expect(Object.keys(piece).sort()).toEqual([
        'confirmedAt',
        'createdAt',
        'id',
        'mimeType',
        'originalName',
        'sizeBytes',
        'status',
      ]);
    });

    it('refuse la liste sur une demande fermee', async () => {
      const { service } = build({
        requests: [depositRequest(REQUEST_A, LAWYER_A, { status: 'SUBMITTED' })],
        documents: [document(DOCUMENT_A, REQUEST_A)],
      });

      await expect(service.listForDeposit(REQUEST_A)).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('cote avocat — isolation par proprietaire', () => {
    it('liste les pieces de sa propre demande', async () => {
      const { service } = build({ documents: [document(DOCUMENT_A, REQUEST_A)] });

      const pieces = await service.listForLawyer(LAWYER_A, REQUEST_A);
      expect(pieces.map((p) => p.id)).toEqual([DOCUMENT_A]);
    });

    it('REFUSE de lister les pieces de la demande d un confrere', async () => {
      // La demande de B et sa piece existent bel et bien dans le magasin : si le
      // filtre `lawyerId` disparaissait, ce test echouerait.
      const { service, store } = build({
        requests: [depositRequest(REQUEST_A, LAWYER_A), depositRequest(REQUEST_B, LAWYER_B)],
        documents: [document('piece-de-b', REQUEST_B)],
      });

      expect(store.documents.find((d) => d.id === 'piece-de-b')).toBeDefined();

      await expect(service.listForLawyer(LAWYER_A, REQUEST_B)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('liste les pieces meme apres soumission', async () => {
      // Symetrie importante : le lien client est mort, mais l avocat doit
      // evidemment continuer d acceder au dossier recu.
      const { service } = build({
        requests: [
          depositRequest(REQUEST_A, LAWYER_A, { status: 'SUBMITTED', submittedAt: new Date() }),
        ],
        documents: [document(DOCUMENT_A, REQUEST_A)],
      });

      await expect(service.listForLawyer(LAWYER_A, REQUEST_A)).resolves.toHaveLength(1);
    });

    it('produit une URL de telechargement temporaire pour sa propre piece', async () => {
      const { service } = build({ documents: [document(DOCUMENT_A, REQUEST_A)] });

      const url = await service.createDownloadUrl(LAWYER_A, REQUEST_A, DOCUMENT_A);

      expect(url).toContain('signature=');
      expect(url).toContain(encodeURIComponent('avis.pdf'));
    });

    it('REFUSE de telecharger la piece d un confrere', async () => {
      const { service } = build({
        requests: [depositRequest(REQUEST_A, LAWYER_A), depositRequest(REQUEST_B, LAWYER_B)],
        documents: [document('piece-de-b', REQUEST_B)],
      });

      await expect(
        service.createDownloadUrl(LAWYER_A, REQUEST_B, 'piece-de-b'),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('refuse de telecharger une piece rattachee a une autre demande', async () => {
      // Les deux demandes appartiennent au MEME avocat : le controle de
      // proprietaire passe, et c est le rattachement du document qui doit
      // bloquer. Sans le `requestId` dans le WHERE, l avocat pourrait lire une
      // piece via l identifiant d une autre de ses demandes — et surtout, la
      // meme faille cote client permettrait de sortir de sa demande.
      const { service } = build({
        requests: [depositRequest(REQUEST_A, LAWYER_A), depositRequest(REQUEST_B, LAWYER_A)],
        documents: [document(DOCUMENT_A, REQUEST_B)],
      });

      await expect(
        service.createDownloadUrl(LAWYER_A, REQUEST_A, DOCUMENT_A),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('refuse de telecharger une piece non confirmee', async () => {
      // Une ligne PENDING n a pas d octets garantis : signer une URL vers un
      // objet absent donnerait une erreur incomprehensible cote navigateur.
      const { service } = build({
        documents: [document(DOCUMENT_A, REQUEST_A, { status: 'PENDING', confirmedAt: null })],
      });

      await expect(
        service.createDownloadUrl(LAWYER_A, REQUEST_A, DOCUMENT_A),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });
});
