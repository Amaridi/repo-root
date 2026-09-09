# Session IA — bloc 5 : upload securise vers MinIO et soumission du depot

**Date** : 9 septembre 2026
**Outil** : Claude Code (CLI)
**Perimetre couvert** : `StorageModule` et `DocumentsModule` (upload presigne,
liste, telechargement temporaire), puis `POST /submit` cloturant le parcours
client. Premiers tests Jest du projet.

> ## Nature de ce document
>
> `/export` n'etant pas disponible dans cet environnement, ce fichier est une
> **transcription reconstituee**, pas une capture brute du terminal.
>
> - **Les prompts utilisateur sont verbatim.**
> - **Les reponses de l'assistant sont fideles mais condensees** ; le code
>   integralement present dans le depot est resume, avec renvoi au fichier.
> - **Les resultats de tests sont reproduits tels qu'obtenus** (sorties `curl`
>   reelles contre PostgreSQL et MinIO, sortie Jest reelle).
>
> Suite de `bloc1-bloc2.md` et `bloc3-bloc4.md`.

---

## Tour 1 — Upload securise vers MinIO / S3

### Prompt

> Maintenant, implémente l'upload sécurisé des documents vers MinIO/S3.
>
> Objectif :
> Le client authentifié par son lien public + PIN doit pouvoir déposer des
> documents sans que les fichiers soient stockés sur le disque local du backend.
>
> Architecture souhaitée :
>
> Client
> → NestJS
> → MinIO/S3
>
> et les métadonnées du document dans PostgreSQL.
>
> À implémenter :
>
> 1. Un service de stockage objet utilisant l'API S3 compatible avec MinIO.
> 2. La génération de clés d'objet uniques.
> 3. L'upload des fichiers vers MinIO.
> 4. L'enregistrement des métadonnées du fichier dans `Document`.
> 5. Les vérifications de taille et de type de fichier.
> 6. La protection des endpoints par l'autorisation client obtenue après validation du PIN.
> 7. Un endpoint permettant de lister les documents d'une demande.
> 8. Un endpoint permettant de télécharger un document via une URL temporaire/presigned URL.
>
> Sécurité :
>
> * Aucun fichier utilisateur ne doit être écrit dans `uploads/` ou ailleurs sur le filesystem du backend.
> * Le bucket MinIO doit rester privé.
> * Les URLs de téléchargement doivent être temporaires.
> * Ne jamais exposer directement les credentials MinIO au frontend.
> * Vérifier que le client ne peut accéder qu'aux documents de sa propre demande.
>
> Utilise l'infrastructure MinIO déjà créée.
>
> Ne fais pas encore le dashboard frontend.
>
> À la fin :
>
> * Vérifie que le backend compile.
> * Vérifie que l'upload fonctionne avec MinIO.
> * Résume en maximum 5 points.
> * Liste les fichiers créés/modifiés.

### Point d'architecture souleve avant de coder

Le schema du prompt (`Client -> NestJS -> MinIO`) suggerait que les octets
transitent par NestJS, alors que le tour 3 de la session de conception avait
valide le **presigned PUT** et la contrainte « aucun fichier sur le disque du
backend ».

Arbitrage retenu et annonce : flux presigne, NestJS decide et signe, **les
octets vont du navigateur directement a MinIO**.

```
Client --1. demande d autorisation--> NestJS --> PostgreSQL (metadonnees, PENDING)
       <-2. presigned PUT (10 min)---
       --3. PUT des octets------------------------> MinIO
       --4. confirm-----------------> NestJS --HeadObject--> MinIO   -> AVAILABLE
```

Motif : c est la seule variante qui satisfait la contrainte **par
construction** — le process Node ne voit jamais un octet de fichier, il ne peut
donc pas en ecrire un, meme sur une erreur de configuration Multer. Proposition
faite de basculer sur un proxy en flux si l intention etait bien celle-la.

### Reponse (condensee) — 5 points

1. **Les octets ne traversent jamais le backend.** `StorageService` n a
   deliberement aucune methode du type `uploadFile(path)` : il ne sait que
   *signer*. Verifie : aucun fichier utilisateur dans `backend/`, aucun dossier
   `uploads/`, `tmp/` ou `storage/`.

2. **Deux clients S3, et c est essentiel.** Le presigner est configure sur
   `S3_PUBLIC_ENDPOINT` — une signature SigV4 couvre l en-tete `Host`, donc une
   URL signee sur `http://minio:9000` serait inutilisable par le navigateur et
   l erreur ne se verrait que cote client. Les appels serveur-a-serveur
   (`HeadObject`, `Delete`) passent par l endpoint interne. `forcePathStyle`
   place le bucket en premier segment du chemin, ce qui rend le routage nginx de
   production valide sans reecriture.

3. **Rien de ce que declare le client n est cru.** La ligne `Document` nait en
   `PENDING` ; elle ne passe `AVAILABLE` qu apres un `HeadObject` qui donne la
   taille reelle et le type reel. Un fichier hors gabarit ou de type mensonger
   est supprime du stockage et sa ligne effacee. Sans cette etape, la liste de
   l avocat contiendrait des fantomes.

4. **Le client ne peut designer que sa propre demande.** Aucune route de depot
   ne prend d identifiant de demande : il vient exclusivement de la session
   issue du PIN. Cote avocat, l appartenance est dans le `WHERE` et renvoie
   **404, pas 403**.

5. **Bucket strictement prive, identifiants MinIO jamais exposes.**
   Telechargement par redirection 302 vers une presigned GET de 60 s, nom
   d origine reinjecte en `Content-Disposition` (RFC 5987 pour les accents). Un
   `GET` sans signature sur le meme objet renvoie 403.

### Ecart trouve pendant les tests, et corrige

Le commentaire initial affirmait que le `Content-Type` signe etait impose au
client. **C etait faux** : un `PUT` en `text/plain` sur une URL signee pour
`application/pdf` a renvoye 200. Une URL presignee ne contraint pas les en-tetes
envoyes.

Correction apportee : le type reel est desormais verifie a la confirmation,
comme la taille. Un fichier depose sous un type mensonger est rejete en 400
**et purge du bucket**. Les commentaires du code ont ete repris pour dire ce que
le systeme fait reellement.

### Tests executes (API reelle, PostgreSQL + MinIO)

| Cas | Resultat |
|---|---|
| `/health/ready` | `{database: up, storage: up}` — la promesse du bloc 1 est tenue |
| Autorisation de depot | 201, URL signee, `expiresAt`, en-tete requis |
| **PUT reel vers MinIO** | **200, 69 octets transferes** |
| Confirmation | 200, `AVAILABLE`, taille reelle 69 o, demande passee en `IN_PROGRESS` |
| Confirmation rejouee | 200 — idempotent |
| Type mensonger (`text/plain` pour un PDF) | 400 + **objet supprime du bucket** |
| Executable / extension incoherente / 30 Mo / traversee de chemin / taille nulle | 400 sur les cinq |
| Quota par demande | 409 au 11e document |
| Sans session client | 401 sur depot et liste |
| Liste avocat | 1 document, **`storageKey` non expose** |
| Telechargement | 302 -> URL signee 60 s, `Content-Disposition` correct, **contenu identique a l original** |
| Acces direct sans signature | **403** — bucket prive |
| Confrere authentifie sur les pieces d autrui | **404** sur liste et telechargement |
| Cookie client sur route avocat | 401 |
| Bucket apres tous les tests | 2 objets, tous deux legitimes |

**Honnetete de methode** : la premiere passe du test d isolation donnait 401 et
non 404, parce que `prisma:reset` avait supprime le second avocat entre-temps —
le test ne prouvait donc rien. Il a ete refait apres recreation du compte :
**404 confirme**, avec un avocat reellement authentifie.

### Fichiers

**Crees** — `backend/src/storage/` : `storage.service.ts`, `storage.module.ts`.
`backend/src/documents/` : `documents.service.ts`, `document-rules.ts`,
`deposit-documents.controller.ts`, `lawyer-documents.controller.ts`,
`documents.module.ts`, `dto/request-upload.dto.ts`, `dto/document.view.ts`.

**Modifies** — `src/app.module.ts`, `src/health/health.controller.ts`
(`/health/ready` controle desormais le stockage).

### Verifications

`tsc --noEmit` : OK. `nest build` : OK. Upload verifie contre MinIO reel.

**Manque signale en fin de tour** : `POST .../submit` absent, donc le parcours
client restait incomplet — le lien ne pouvait pas etre ferme par le client.

---

## Tour 2 — Soumission du depot

### Prompt

> Termine le Bloc 5 en implémentant le POST /submit manquant. Le client
> authentifié via sa deposit_session doit pouvoir soumettre sa demande. Vérifie
> qu'elle est encore ouverte, qu'elle contient au moins un document AVAILABLE,
> passe son statut à SUBMITTED, renseigne submittedAt, et assure-toi qu'après
> soumission le lien public et les routes d'upload ne sont plus utilisables.
> Ajoute les tests nécessaires et ne modifie rien d'autre. À la fin, donne-moi
> uniquement un résumé court des changements et des tests exécutés.

### Reponse (condensee)

`submit()` ajoute a `DepositAccessService` : `assertOpenForDeposit`, comptage
des documents `AVAILABLE`, puis `updateMany` avec le statut dans le `WHERE`
(`PENDING` / `IN_PROGRESS`). La double soumission et l ecrasement d un statut
`CLOSED` pose par l avocat sont donc impossibles, meme en concurrence. Route
`POST /api/public/deposits/session/submit` protegee par `DepositSessionGuard`.

Rien d autre n a ete touche.

### Tests unitaires Jest — 8/8

Premiers tests unitaires du projet, Prisma mocke :

`SUBMITTED` + `submittedAt` renseigne · seuls les documents `AVAILABLE` comptes ·
refus sans document · refus si expiree · refus si deja soumise · refus si
cloturee · refus si inexistante · refus si le statut change entre la
verification et l ecriture (`updateMany` a 0 ligne).

### Tests bout en bout (PostgreSQL + MinIO)

| Cas | Resultat |
|---|---|
| Submit sans aucun document | **400** |
| Submit avec un fichier depose mais **non confirme** | **400** — les lignes `PENDING` ne comptent pas |
| Submit apres confirmation | **200** `{status: SUBMITTED, submittedAt, documentsCount: 1}` |
| Apres soumission : resolve, verify-pin (bon PIN), session/me, POST documents, confirm, GET documents, submit a nouveau | **404 sur les sept** |
| Cote avocat apres soumission | statut `SUBMITTED`, `submittedAt` present, liste **200**, telechargement **302** |

### Deux obstacles Jest, hors code metier

1. **L installation de Jest etait incomplete** — `jest-resolve` renvoyait `null`
   meme pour un chemin absolu existant. Un `npm install` a ajoute 28 paquets
   manquants. Ce n etait donc pas le melange WSL/Windows d abord soupconne : la
   piste a ete explicitement abandonnee apres verification.

2. **NestJS 12 est distribue uniquement en ESM** (`"type": "module"`, aucun
   build CommonJS). L application tourne parce que Node 22 sait faire
   `require(esm)`, mais le runtime de Jest refuse ce pont sous Node 24.9. Jest
   tourne donc **en mode ESM natif** : `useESM` cote ts-jest, globales importees
   depuis `@jest/globals`, et `--experimental-vm-modules` fige dans le script
   `npm test`. **Aucune version n a eu besoin d etre changee.**

   Consequence pour la suite : tout nouveau `.spec.ts` doit importer `jest`,
   `describe`, `it`, `expect` depuis `@jest/globals` au lieu de compter sur les
   globales.

### Fichiers

**Cree** — `src/deposit-access/deposit-access.service.spec.ts` (8 tests).

**Modifies** — `src/deposit-access/deposit-access.service.ts` (methode
`submit`), `src/deposit-access/deposit-access.controller.ts` (route),
`jest.config.js` et `package.json` (configuration Jest en mode ESM).

### Verifications

`tsc --noEmit` : OK. `npm test` : 8/8. `nest build` : OK.

---

## Endpoints disponibles a la fin de ce bloc

```
Espace avocat (cookie depot_session, aud: lawyer)
  POST   /api/auth/login | logout        GET /api/auth/me
  POST   /api/deposits                              creation + lien et PIN, une seule fois
  GET    /api/deposits                              ses propres demandes
  GET    /api/deposits/:id                          detail
  GET    /api/deposits/:id/documents                pieces deposees
  GET    /api/deposits/:id/documents/:docId/download  302 vers presigned GET 60 s

Parcours client (cookie deposit_session, aud: deposit)
  GET    /api/public/deposits/:token                metadonnees, avant PIN
  POST   /api/public/deposits/:token/verify-pin     ouvre la session
  GET    /api/public/deposits/session/me            etat de la demande
  POST   /api/public/deposits/session/documents     autorisation de depot (presigned PUT)
  POST   /api/public/deposits/session/documents/:id/confirm
  GET    /api/public/deposits/session/documents     ses propres pieces
  POST   /api/public/deposits/session/submit        soumission definitive
  POST   /api/public/deposits/session/logout

Exploitation
  GET    /api/health/live | /api/health/ready       (base + stockage)
  GET    /api/docs                                  OpenAPI
```

## Etat du projet

**Le parcours metier complet est fonctionnel et verifie a l execution** :
l avocat cree une demande, le client ouvre le lien, saisit le PIN, depose ses
pieces directement dans MinIO, soumet ; l avocat consulte et telecharge. Le lien
est mort apres soumission.

**Points ouverts :**

1. **Mode de terminaison TLS du proxy frontal DIV** — question redigee dans
   `infra/nginx/README.md`. Prerequis du deploiement.
2. **Frontend** : seuls le squelette et la page de charte existent.
3. **Observabilite** : Prometheus et Grafana pas encore branches.
4. **Couverture de tests** : 8 tests sur la soumission. Restent a couvrir
   l expiration des liens, la verification du PIN et le verrouillage, qui sont
   dans l Attendu du sujet.
5. `expiresInDays` (ajout du bloc 3) toujours en attente de validation.
