# Portail de Depot de Pieces

Application permettant a un avocat de solliciter des documents aupres d'un client,
via un lien public unique, expirable et protege par un code PIN. Le client depose
ses pieces sans creer de compte. Les fichiers sont stockes dans un service objet
compatible S3 ; aucun fichier utilisateur ne touche le disque de l'application.

- **Backend** NestJS 12 / TypeScript, PostgreSQL 16, Prisma 6
- **Frontend** React 19, Vite, Chakra UI v3
- **Stockage** MinIO (compatible S3), conteneurise
- **Observabilite** Prometheus + Grafana
- **Deploiement** image Docker publiee sur GHCR, tiree sur le serveur, HTTPS

## Instance de production

**https://amar-idinarene.stage2-div.rayan-drissi.com**

| | |
|---|---|
| Application | https://amar-idinarene.stage2-div.rayan-drissi.com |
| API | `/api` — documentation OpenAPI sur `/api/docs` |
| Tableaux de bord | `/grafana/` |
| Metriques | `/prometheus/` (authentification basique) |
| Images | `ghcr.io/amaridi/depot-backend:1.0.0` et `ghcr.io/amaridi/depot-frontend:1.0.0` |
| TLS | Let's Encrypt, renouvellement automatique |

**Compte avocat de demonstration** : `avocat@div-protocol.test`

Le mot de passe est genere aleatoirement par `install.sh` au moment du
deploiement et **n'est pas dans ce depot** — il est transmis avec le rendu. Un
mot de passe de demonstration ecrit dans un README public serait un identifiant
de production en clair dans Git, ce que le sujet interdit precisement.

En local, `install.sh local` affiche le mot de passe qu'il vient de generer, a
la fin de son execution.

---

## Sommaire

0. [Instance de production](#instance-de-production)
1. [Demarrage rapide](#1-demarrage-rapide)
2. [Analyse du besoin](#2-analyse-du-besoin)
3. [Architecture](#3-architecture)
4. [Modele de donnees](#4-modele-de-donnees)
5. [Authentification avocat](#5-authentification-avocat)
6. [Parcours client et validation du PIN](#6-parcours-client-et-validation-du-pin)
7. [Strategie de stockage objet](#7-strategie-de-stockage-objet)
8. [Strategie de tests](#8-strategie-de-tests)
9. [Observabilite](#9-observabilite)
10. [Deploiement](#10-deploiement)
11. [Charte graphique](#11-charte-graphique)
12. [Perimetre assume](#12-perimetre-assume)
13. [Journal des conversations IA](#13-journal-des-conversations-ia)

---

## 1. Demarrage rapide

### Prerequis

- Docker Engine + plugin Compose v2 (ou Docker Desktop), Node.js 22, openssl.
- **Sous Linux, l'utilisateur doit appartenir au groupe `docker`**, sinon le
  demon repond `permission denied` sur `/var/run/docker.sock` :

  ```bash
  sudo usermod -aG docker "$USER"
  newgrp docker          # ou fermer puis rouvrir la session
  ```

  `install.sh` detecte ce cas et affiche la commande a executer.

### Installation

```bash
./install.sh local
```

Le script genere `.env` avec des secrets aleatoires, demarre PostgreSQL et MinIO,
provisionne le bucket, applique les migrations, cree le compte avocat de
demonstration, puis affiche les URLs et les identifiants.

Puis, dans deux terminaux :

```bash
cd backend  && npm run start:dev
cd frontend && npm run dev
```

| Service | URL locale |
|---|---|
| Application | http://127.0.0.1:22470 |
| Charte graphique | http://127.0.0.1:22470/_charte |
| API | http://127.0.0.1:22409/api |
| Documentation OpenAPI | http://127.0.0.1:22409/api/docs |
| Console MinIO | http://127.0.0.1:22401 |

### Migrations : qui ecrit, qui applique

La distinction est volontaire et vaut pour les deux environnements.

| Commande | Role | Qui l'execute |
|---|---|---|
| `npm run prisma:migrate -- --name <nom>` | **Ecrit** un nouveau fichier de migration a partir du schema, et le versionne | le developpeur, une fois par evolution du schema |
| `npm run prisma:deploy` | **Applique** les migrations deja versionnees | `install.sh`, a chaque installation |

`install.sh` n'appelle jamais `migrate dev` : un script d'installation ne doit
pas inventer de schema, il applique ce qui est dans le depot. Si le dossier
`backend/prisma/migrations/` est vide, le script s'arrete en indiquant la
commande a lancer.

### Un seul environnement d'execution : WSL ou Windows, pas les deux

Le depot est sur le disque Windows et peut etre ouvert depuis WSL via `/mnt/c`.
Les deux environnements partagent alors le **meme `node_modules`**, ce qui casse
deux choses :

- **Les moteurs Prisma.** Le client est genere pour une plateforme donnee ; un
  `prisma generate` lance d'un cote rend le client inutilisable de l'autre
  (`Query Engine could not be located`). Le schema declare donc
  `binaryTargets = ["native", "windows", "debian-openssl-3.0.x"]`, ce qui
  embarque les deux moteurs.
- **Les raccourcis de `node_modules/.bin`.** Un `npm install` lance sous Linux
  cree des liens symboliques sans les fichiers `.cmd` attendus par Windows.
  `npm run <script>` retombe alors sur un homonyme du `PATH` — par exemple le
  `dotenv` de Python au lieu de celui du projet. Les scripts npm invoquent donc
  les points d'entree JavaScript directement
  (`node ./node_modules/dotenv-cli/cli.js ...`), ce qui fonctionne des deux
  cotes.

Ces deux garde-fous evitent l'echec silencieux, mais la recommandation reste de
**travailler dans un seul environnement**. Docker tournant sous WSL, WSL est le
choix naturel. En cas de doute apres un changement de cote :

```bash
rm -rf backend/node_modules frontend/node_modules
./install.sh local
```

### Arborescence

```
exo2-portail-depot/
├── backend/            API NestJS + schema Prisma
├── frontend/           SPA React + Chakra UI v3
├── infra/              nginx, MinIO, Prometheus, Grafana
├── ai-logs/            export des conversations IA
├── install.sh          installation locale et deploiement
└── README.md
```

---

## 2. Analyse du besoin

Trois acteurs, deux surfaces d'authentification radicalement differentes.

| Acteur | Authentification | Surface |
|---|---|---|
| Avocat | Compte + mot de passe (JWT) | Espace prive : creation et suivi des demandes, consultation des pieces |
| Client | **Aucun compte** — lien unique + PIN | Page publique `/d/:token` : saisie du PIN puis depot |

Deux invariants structurent tout le reste.

**1. Aucun fichier utilisateur sur le disque de l'application.** Les octets ne
doivent jamais traverser le process Node. C'est ce qui impose les URLs
presignees (section 7) et rend l'application sans etat, donc scalable
horizontalement.

**2. Le lien public est la seule barriere avant le PIN.** Il doit etre non
devinable, expirable, revocable, a tentatives limitees, et stocke hache
(section 6).

---

## 3. Architecture

### Un hostname unique, routage par chemin

Le serveur d'exercice est partage entre plusieurs candidats : les services
ecoutent exclusivement sur `127.0.0.1` dans la plage de ports assignee
`22400-22499`, et un proxy frontal mutualise route le trafic HTTPS. Un seul
sous-domaine est disponible.

```
                          ┌─ /                   -> frontend (SPA servie par nginx)
                          ├─ /api/*              -> backend NestJS
proxy frontal ── 22401 ───┼─ /api/metrics        -> REFUSE depuis l'exterieur
   (443, SNI)   nginx     ├─ /depot-documents/*  -> MinIO (presigned PUT / GET)
                  (TLS)   ├─ /grafana/*          -> Grafana
                          └─ /prometheus/*       -> Prometheus (auth basique)

proxy frontal ── 22400 ── nginx : redirige vers HTTPS,
   (80)                           sauf /.well-known/acme-challenge/

     reseau interne du compose, aucun port publie :
     PostgreSQL, MinIO, backend, frontend, Prometheus, Grafana
```

**Consequence favorable** : origine unique, donc **aucun CORS** et cookie de
session en `SameSite=Strict` sans attribut `Domain`.

**Le point delicat** : les presigned URLs sont consommees par le navigateur,
donc MinIO doit etre joignable via ce meme hostname. Or la signature SigV4
couvre a la fois l'en-tete `Host` et le chemin : si nginx reecrit un prefixe,
toutes les signatures deviennent invalides. La solution retenue exploite le
format *path-style* de S3, dont le premier segment est le nom du bucket :
`https://<host>/depot-documents/<key>?X-Amz-...` est deja une URL S3 valide.
nginx route `location /depot-documents/` vers MinIO **sans reecriture**, le
chemin signe est recu tel quel, la signature reste valide. Le nom du bucket
sert de prefixe de routage.

*Alternatives ecartees* : un sous-domaine dedie a MinIO (impossible, un seul
sous-domaine attribue) ; faire proxifier les octets par le backend (violerait
l'invariant n°1) ; reecrire la signature dans nginx (fragile et inutile).

### Allocation des ports (22400-22499)

**En production**, deux ports publies, et deux seulement :

| Port | Service | Expose |
|---|---|---|
| 22400 | nginx HTTP | `127.0.0.1` — cible du port 80 externe (ACME + redirection) |
| 22401 | nginx HTTPS | `127.0.0.1` — cible du port 443 externe, passthrough SNI |
| — | PostgreSQL, MinIO, backend, frontend, Prometheus, Grafana | aucun port publie, reseau interne du compose |

**En developpement**, le backend et le frontend tournent sur l'hote et
l'infrastructure est conteneurisee :

| Port | Service | Expose |
|---|---|---|
| 22470 | serveur de developpement Vite | 127.0.0.1 |
| 22409 | backend NestJS | 127.0.0.1 |
| 22432 | PostgreSQL | 127.0.0.1 |
| 22400 / 22401 | MinIO API / console | 127.0.0.1 |
| 22490 / 22491 | Grafana / Prometheus | 127.0.0.1 |

Les ports 22400 et 22401 servent donc a MinIO en developpement et a nginx en
production. Les deux environnements ne tournent jamais sur la meme machine, et
les fichiers `.env` sont distincts (`.env.example` contre
`.env.prod.example`).

### Modules NestJS

Le decoupage est **par domaine**, pas par couche technique.

| Module | Role |
|---|---|
| `AuthModule` | Connexion avocat, deconnexion, profil, garde JWT |
| `DepositModule` | CRUD des demandes cote avocat, generation lien + PIN, statuts |
| `DepositAccessModule` | Parcours **public** : resolution du token, verification du PIN, session de depot |
| `DocumentsModule` | Intention d'upload, confirmation, listing, telechargement |
| `StorageModule` | Port S3 : seul module qui connaisse MinIO |
| `HealthModule` | `/api/health/live`, `/api/health/ready` |
| `MetricsModule` | `/api/metrics` pour Prometheus |
| `PrismaModule` | Client de base de donnees, global |

**Pourquoi separer `DepositModule` (prive) et `DepositAccessModule`
(public) alors qu'ils manipulent la meme table** : ce sont deux surfaces
d'attaque et deux modeles d'autorisation differents. La separation rend
impossible la fuite accidentelle d'un champ sensible (`pinHash`, `tokenHash`,
identite de l'avocat, liste des autres demandes) par un DTO partage.
L'alternative — un module unique avec des gardes conditionnelles — transforme
chaque endpoint en `if (isPublic)`, c'est-a-dire exactement le terrain ou
naissent les failles d'acces direct aux objets.

`StorageModule` expose une interface (`createUploadUrl`, `createDownloadUrl`,
`statObject`, `removeObject`). Cout : une quarantaine de lignes. Benefice : les
tests unitaires n'ont pas besoin de MinIO, et passer a AWS S3 ne demande que de
changer trois variables d'environnement.

### Choix d'outillage

| Choix | Alternatives | Pourquoi celui-ci |
|---|---|---|
| **Prisma 6** | TypeORM, Drizzle, SQL + Kysely | Migrations declaratives fiables, typage derive du schema, et `schema.prisma` fait office de documentation lisible du modele. **Version 6 et non 7** : la 7 supprime `url` du schema et impose `prisma.config.ts` plus un driver adapter, un modele que la documentation et l'ecosysteme ignorent encore largement. C'est une gestion de risque calendaire, pas un choix technique de fond. |
| **PostgreSQL** | MySQL, SQLite | `jsonb`, `citext`, contraintes solides, conteneurisation triviale. SQLite exclu par la contrainte de base relationnelle conteneurisee. |
| **Zod pour l'environnement** | `class-validator`, `joi` | Le boot echoue bruyamment sur une variable manquante ou mal formee, plutot que de produire un bug silencieux (une presigned URL signee sur le mauvais host n'echoue que cote navigateur). |
| **`@nestjs/jwt` sans Passport** | `passport-jwt`, `passport-local` | Deux gardes de quinze lignes suffisent. Passport ajouterait deux dependances et une couche d'abstraction pour zero fonctionnalite supplementaire ici. |
| **Monorepo a plat** | Nx, Turborepo, deux depots | Un dossier = un artefact Docker. Le seul benefice reel d'un workspace serait le partage de types ; il est remplace par OpenAPI et Zod cote frontend, qui valide aussi a l'execution. |

---

## 4. Modele de donnees

Trois tables. Le schema commente se trouve dans
[backend/prisma/schema.prisma](backend/prisma/schema.prisma).

```
Lawyer          id, email, passwordHash (argon2id), displayName
DepositRequest  id, lawyerId, title, instructions?, clientName, clientEmail?,
                status, tokenHash, pinHash, expiresAt,
                failedAttempts, lockedUntil?, submittedAt?
Document        id, requestId, originalName, storageKey, mimeType, sizeBytes,
                status, confirmedAt?
```

Quatre decisions a defendre.

**`tokenHash` et non `token`.** Le token du lien public n'est jamais stocke en
clair : seul son SHA-256 est conserve. Une fuite de dump SQL ou de journal ne
donne acces a aucun depot. Le token en clair n'existe qu'une seule fois, dans
la reponse HTTP de creation. SHA-256 plutot qu'argon2 parce que le token porte
256 bits d'entropie — il n'est pas brute-forcable — et doit rester consultable
en temps constant a chaque requete publique. Le PIN, lui, ne vaut que 10^6
combinaisons : il est hache avec argon2id.

**`expiresAt` stocke, `isExpired` calcule.** Aucun booleen `expired` en base :
il mentirait des qu'une horloge derive ou qu'une tache planifiee ne tourne pas.
L'expiration est une comparaison, pas un etat persiste. En revanche `SUBMITTED`
et `CLOSED` **sont** des actes metier : ceux-la sont persistes.

**`Document.status` : `PENDING` puis `AVAILABLE`.** Consequence directe de
l'upload presigne : la ligne existe avant les octets. Elle ne passe
`AVAILABLE` qu'apres verification serveur (`HeadObject`), sinon la liste de
l'avocat contiendrait des fantomes.

**`failedAttempts` porte par la demande, pas par l'IP.** Faire tourner son
adresse IP ne remet pas le compteur a zero. Persiste en base et non en memoire,
donc un redemarrage ne l'efface pas — c'est la difference entre une protection
et une decoration.

---

## 5. Authentification avocat

```
POST /api/auth/login  { email, password }
  -> argon2.verify, reponse d'erreur generique (pas de distinction
     "email inconnu" / "mot de passe faux")
  -> JWT 8 h en cookie HttpOnly; Secure; SameSite=Strict; Path=/
POST /api/auth/logout -> cookie efface
GET  /api/auth/me     -> profil, ou 401
```

Le frontend ne manipule aucun token : il ne peut meme pas le lire. Au demarrage,
il appelle `GET /api/auth/me` pour savoir s'il est connecte.

**Pourquoi le cookie `HttpOnly` plutot que `localStorage`** : un token en
`localStorage` est exfiltrable par toute XSS. Un cookie `HttpOnly` est
inaccessible au JavaScript ; `SameSite=Strict` couvre le CSRF sans jeton
anti-CSRF supplementaire, ce qui est possible ici precisement parce que
frontend et API partagent une origine unique.

**Ce qui a ete retire, sciemment** : refresh token, rotation, table de sessions.
La revocation fine et la detection de rejeu en auraient beneficie, mais cela
represente environ deux heures et demie pour un projet cadre a vingt heures.
La consequence est assumee et documentee : un JWT vole reste valable jusqu'a
huit heures. Les alternatives plus robustes seraient une session serveur avec
Redis (revocation instantanee, un service de plus) ou un fournisseur externe
type Keycloak (la bonne reponse en production, hors sujet ici).

Il n'y a pas d'inscription publique : les comptes avocats sont crees par le
seed. C'est coherent avec le metier — un cabinet est ferme — et cela supprime
toute la surface verification d'email et reinitialisation de mot de passe.

---

## 6. Parcours client et validation du PIN

Le lien remis au client : `https://<host>/d/<token>` ou `token` vaut **32 octets
aleatoires en base64url**, soit 256 bits d'entropie — non enumerable.

```
1. GET  /api/public/deposits/:token
     -> 200 : titre, consignes, nom de l'avocat, date d'expiration.
              Metadonnees d'affichage uniquement : aucun document, aucune
              donnee sensible de l'avocat.
     -> 404 generique si le token est inconnu, expire, revoque ou deja soumis.
              Le meme code et le meme corps dans les quatre cas : on ne
              confirme jamais l'existence d'un token a un scanner.

2. POST /api/public/deposits/:token/verify-pin  { pin }
     -> 423 si le verrou est actif
     -> 401 { attemptsLeft } apres echec ; au 5e echec, verrou de 15 minutes
     -> 200 : session de depot, JWT 30 min, audience "deposit",
              scope { requestId, upload }, signe avec une cle DISTINCTE de
              celle des tokens avocat

3. Les appels d'upload exigent cette session et n'acceptent que le requestId
   qu'elle contient.
```

| Menace | Defense |
|---|---|
| Enumeration de tokens | 256 bits d'entropie, reponse 404 uniforme |
| Brute-force du PIN | 5 tentatives puis verrou 15 min, compteur porte par la demande |
| Fuite de base | `pinHash` argon2id, `tokenHash` SHA-256 |
| Rejeu du lien apres depot | statut `SUBMITTED` donne 404 sur le token |
| Attaque temporelle | argon2 est a duree constante, reponses d'erreur homogenes |
| Escalade de privilege | deux cles de signature distinctes : un token de depot ne peut pas etre presente comme un token avocat |

**Pourquoi separer la resolution du token et la verification du PIN** : le
client doit voir « Maitre X vous demande des pieces » avant de saisir un code,
sinon l'ecran est un cul-de-sac. Le compromis — le token seul revele le nom de
l'avocat et l'objet de la demande — est acceptable et documente.

**Pourquoi une session apres le PIN plutot qu'un PIN a chaque requete** : un
depot comporte plusieurs fichiers ; reverifier un hash argon2 a chaque appel
coute environ cent millisecondes de CPU par fichier et obligerait le frontend a
conserver le PIN en clair en memoire. La session courte est plus rapide **et**
plus sure.

Deux facteurs transmis par deux canaux distincts — le lien par courriel, le PIN
par telephone — sans aucune dependance a un service externe (ni SMTP, ni SMS),
ce qui garantit que la demonstration ne depend de rien.

---

## 7. Strategie de stockage objet

**Principe : les octets ne touchent jamais le backend.**

```
1. POST /api/public/deposits/:token/documents   [session de depot requise]
     { filename, mimeType, sizeBytes }
     -> validation serveur : type MIME en liste blanche, taille annoncee,
        quota par demande
     -> INSERT Document (status PENDING, storageKey genere)
     -> 201 { documentId, uploadUrl }   presigned PUT, 10 minutes

2. Le NAVIGATEUR fait le PUT directement sur MinIO.

3. POST /api/documents/:id/confirm             [session de depot requise]
     -> HeadObject : l'objet existe ? la taille reelle est-elle conforme ?
     -> si la taille depasse la limite, l'objet est supprime et l'appel echoue
     -> status AVAILABLE

4. POST /api/public/deposits/:token/submit
     -> status SUBMITTED, le lien ne fonctionne plus

Telechargement avocat :
   GET /api/requests/:id/documents/:docId/download
     -> 302 vers une presigned GET de 60 s, avec Content-Disposition
```

Convention de cle : `deposits/{requestId}/{documentId}/{slug(nom)}`. Le nom
fourni par le client n'est **jamais** utilise comme cle — path traversal,
collisions, unicode. Il est conserve en base pour l'affichage et reinjecte au
telechargement via `Content-Disposition`.

Configuration du bucket, dans [infra/minio/init.sh](infra/minio/init.sh),
idempotente et a echec fatal : bucket strictement prive (aucun acces anonyme,
verifie explicitement apres application) et versioning active.

**Le CORS n'est pas une configuration de bucket.** MinIO ne l'implemente pas a
ce niveau : `mc cors set` repond « functionality that is not implemented ». Il
se declare au niveau du serveur, par `MINIO_API_CORS_ALLOW_ORIGIN` sur le
service minio de `docker-compose.yml`. C'est necessaire parce que le navigateur
televerse directement dans MinIO ; sans cette variable, MinIO accepte n'importe
quelle origine.

Aucune regle de cycle de vie n'est posee : `mc` refuse une regle limitee a
`AbortIncompleteMultipartUpload`, et ce n'est pas genant — les depots se font
par PUT simple, pas en multipart. Le residu reellement a nettoyer est cote
base : les lignes `Document` restees `PENDING` dont les octets ne sont jamais
arrives. C'est un point d'amelioration connu, pas un acquis.

**Presigned PUT plutot que presigned POST** : la policy d'un POST permettrait
d'imposer `content-length-range` cote S3, donc de rejeter un fichier trop gros
*avant* transfert. Le PUT ne le permet pas ; la taille reelle est donc verifiee
a la confirmation, et l'objet supprime s'il depasse. Le PUT represente trois
lignes de SDK contre une policy a construire : arbitrage assume au profit du
delai, avec une limite documentee — un client malveillant peut consommer de la
bande passante avant d'etre rejete.

**Alternatives ecartees** : proxifier le flux via NestJS (`multer`) serait plus
simple a ecrire et permettrait un antivirus en ligne, mais consommerait la
bande passante et la memoire du backend, et toute configuration de stockage
temporaire violerait l'invariant « aucun fichier sur le disque local » ;
stocker les fichiers en base (`bytea`) ne passe pas l'echelle et gonfle les
sauvegardes.

---

## 8. Strategie de tests

**136 tests, 8 suites, Jest en mode ESM natif.** Concentres sur ce qui est
risque, sans viser un pourcentage de couverture.

| Suite | Tests | Ce qui est verifie |
|---|---|---|
| `deposit-secrets.spec.ts` | 12 | entropie et forme du token, empreinte SHA-256, PIN a six chiffres avec zeros de tete, construction du lien |
| `document-rules.spec.ts` | 18 | liste blanche des types, coherence extension/type, bornes de taille, neutralisation des noms de fichiers hostiles |
| `auth.service.spec.ts` | 11 | connexion valide, mauvais mot de passe, compte inconnu, reponses indistinguables, empreinte jamais renvoyee |
| `session-isolation.spec.ts` | 17 | **cloisonnement avocat/client dans les deux sens**, audiences, cles distinctes, expiration, token altere |
| `deposit.service.spec.ts` | 17 | creation, secrets non persistes en clair, duree de validite, isolation entre avocats, statuts |
| `deposit-access.pin.spec.ts` | 24 | PIN correct et faux, compteur, verrou, lien expire/soumis/cloture, session liee a une seule demande |
| `deposit-access.service.spec.ts` | 9 | regles de transition de la soumission, y compris la course entre verification et ecriture |
| `documents.service.spec.ts` | 28 | metadonnees, plafond de pieces, confirmation contre le stockage reel, isolation par demande et par avocat |

### Ce qui est reellement execute, et ce qui est double

Le principe retenu : **ne jamais doubler le mecanisme que le test a pour objet
de verifier.**

- **argon2 est reel.** Un mot de passe et un PIN sont verifies par de vraies
  empreintes. Mocker `argon2.verify` reviendrait a tester qu une fonction est
  appelee, pas qu un mauvais code est refuse.
- **La signature JWT est reelle**, avec deux secrets distincts. Les tokens des
  tests de cloisonnement sont signes et verifies par les gardes de production.
- **Le double de Prisma applique reellement les clauses `where`.** C est le point
  le plus important de cette suite. Un mock qui renvoie `null` quoi qu on lui
  demande ferait passer un test d isolation **meme si le service avait perdu son
  filtre `lawyerId`** — c est exactement le piege dans lequel une verification
  anterieure de ce projet est tombee (un 404 obtenu parce que le second avocat
  n existait pas en base, pas parce que le filtre fonctionnait). Ici le magasin
  contient les demandes des DEUX avocats et le filtre est evalue. Verifie par
  mutation : retirer `lawyerId` des deux clauses `where` du code de production
  fait echouer exactement quatre tests (isolation de la demande, de la liste de
  pieces, du telechargement, et egalite des reponses 404).
- **Le double du stockage retient ce qu on y depose**, avec une taille et un type
  *reels* qui peuvent differer de ce qui avait ete annonce. C est ce qui permet
  de rejouer en test le cas constate en production : une URL presignee en PUT
  n impose pas les en-tetes, donc un depot annonce en `application/pdf` peut
  arriver en `text/plain`.
- **Le vrai `DepositAccessService` est utilise par les tests de documents**,
  parce que c est lui qui porte la regle « cette demande est-elle encore
  ouverte ? », verifiee a chaque ecriture.

Seules la base, le stockage objet, la configuration et l instrumentation sont
doubles — aucun n est l objet du test, et les embarquer rendrait le resultat
dependant de la machine.

### Un bug trouve par ces tests

`ALLOWED_TYPES[mimeType]` sur un objet litteral consulte aussi la **chaine de
prototypes**. Un type annonce `constructor`, `toString` ou `__proto__` renvoyait
une fonction au lieu de `undefined` : le garde ne declenchait pas, le
`.includes()` suivant levait une `TypeError`, et l API repondait **500 au lieu de
400** — depuis une valeur entierement controlee par le client, le DTO acceptant
n importe quelle chaine de 3 a 120 caracteres. Confirme contre l API reelle, puis
corrige avec `Object.hasOwn`. Sans consequence sur la confidentialite, mais un
5xx declenchable a volonte fausse la regle d alerte de la section 9.

### Ce qui n est pas teste, volontairement

Les controleurs, qui ne font que traduire HTTP vers service ; les DTO, deja
garantis par `class-validator` ; le frontend. Il n y a **pas de suite end-to-end
HTTP** : elle exigerait `supertest` et une base reelle (Testcontainers), hors du
budget de vingt heures. Le parcours complet a en revanche ete verifie
manuellement de bout en bout contre PostgreSQL et MinIO, et le detail figure dans
`ai-logs/`.

Aucun seuil de couverture global n est fixe : un pourcentage moyen ne dit rien,
alors que « vingt-quatre tests sur le PIN et l expiration, dix-sept sur le
cloisonnement des sessions » decrit des menaces.

---

## 9. Observabilite

```
backend NestJS                Prometheus                    Grafana
  /api/metrics    <--scrape--  22491        <--datasource--  22490
  (prom-client)                + regles d'alerte            + dashboard
                               infra/prometheus/rules/       infra/grafana/
```

Tout est provisionne par fichier, jamais clique dans une interface : une
datasource ou un dashboard cree a la main vit dans le volume Grafana, donc il
disparait au premier `docker compose down -v` et n'existe pas sur la machine du
relecteur. `install.sh` suffit, il n'y a aucune etape manuelle.

### Ce qui est mesure, et pourquoi seulement cela

Six metriques applicatives, plus les metriques de processus fournies par
`prom-client`. Le choix de s'arreter la est delibere : une metrique qu'on ne
regarde jamais coute le meme travail de maintenance qu'une metrique utile, et
noie celles qui comptent.

| Metrique | Type | Ce qu'elle permet de decider |
|---|---|---|
| `http_requests_total{method,route,status}` | compteur | reperer une route qui se degrade, calculer un taux d'erreur |
| `http_request_duration_seconds{method,route}` | histogramme | latence p95 par route ; les bornes sont calees sur ce service (argon2 ~100 ms, signature ~10 ms) |
| `deposit_requests_created_total` | compteur | activite des avocats |
| `deposit_submissions_total` | compteur | **la mesure de valeur** : un depot soumis est un dossier complet recu |
| `deposit_pin_verifications_total{outcome}` | compteur | `outcome` valant `success`, `invalid` ou `locked` : signal d'abus, et denominateur pour un taux |
| `document_uploads_total{outcome}` | compteur | `confirmed`, `rejected` (taille ou type reels non conformes, objet supprime), `failed` (aucun objet recu) |

**Le label `route` est le gabarit de route, jamais l'URL demandee.** C'est la
decision la plus importante de cette section : une URL de depot contient le
token d'acces. L'utiliser comme label creerait une serie temporelle par demande
— explosion de cardinalite — et surtout **divulguerait les tokens a quiconque lit
`/api/metrics`**. Les valeurs observees sont donc de la forme
`/api/public/deposits/:token/verify-pin`. Les requetes qui n'apparient aucune
route sont etiquetees `unmatched` : sans ce repli, un robot qui teste mille
chemins creerait mille series permanentes.

Les valeurs de labels metier sont des types TypeScript fermes
(`PinOutcome`, `UploadOutcome`) : la cardinalite est bornee par le compilateur,
pas par la discipline du developpeur.

### L'alerte principale : backend indisponible

`up{job="depot-backend"} == 0` pendant 1 minute, severite critique.

Ce choix se justifie par le produit, pas par l'habitude. Ici,
l'indisponibilite n'est pas une gene, elle est **irreversible** : le client
dispose d'un lien a duree limitee et de cinq essais de code ; s'il tombe sur une
erreur, il n'a personne a appeler, il abandonne, et l'avocat rate une echeance
de procedure. Toutes les autres metriques sont sans objet si celle-ci vaut zero.

`up` est produit par Prometheus lui-meme et non par l'application : c'est la
seule mesure qui reste vraie quand le service ne repond plus. Une alerte fondee
sur un compteur applicatif ne peut, par construction, pas detecter l'absence
d'application. `for: 1m` absorbe un redemarrage volontaire sans reveiller
personne.

Deux autres regles completent, une par famille de panne :

- **`TauxErreursServeurEleve`** — plus de 5 % de 5xx pendant 10 minutes,
  **avec un garde-fou de trafic** (`> 0.05 req/s`). Le garde-fou est la partie
  importante : sur un service peu sollicite, un ratio nu est un piege, une seule
  requete en erreur dans une heure creuse donne 100 % et declenche une alerte
  critique pour un incident inexistant. Seuls les 5xx sont comptes — un 4xx est
  le systeme qui fonctionne (PIN invalide, lien expire, fichier refuse).
- **`RafaleDeCodesInvalides`** — la seule alerte que ce projet-ci pouvait avoir.
  Le verrouillage protege **chaque demande prise separement** (cinq essais puis
  blocage) ; il est aveugle a un attaquant qui balaie mille liens a raison de
  deux essais chacun. Cette regle regarde le systeme entier, la ou la defense
  applicative regarde une ligne de table.

**Pas d'Alertmanager**, deliberement : le sujet demande qu'une alerte pertinente
existe et soit evaluee, pas qu'elle notifie. Un canal SMTP ou webhook imposerait
des identifiants a stocker pour une valeur nulle en soutenance. Les regles sont
evaluees et visibles dans `/prometheus/alerts` ; brancher un canal est une ligne
de configuration le jour ou une astreinte existe.

### Points d'attention du montage

**`prom-client` est utilise directement**, sans le module NestJS qui l'enveloppe
habituellement (`@willsoto/nestjs-prometheus`) : ce paquet est publie en
CommonJS et fait un `require` de `@nestjs/common`, qui est en ESM pur depuis
NestJS 12. Sous Jest en mode ESM, ce `require` echoue et rend intestable tout
fichier qui l'importe transitivement — ce qui incluait le service de depot.
Supprimer la dependance coute vingt lignes et retire le probleme au lieu de le
masquer derriere un transform supplementaire.

**La mesure HTTP est un middleware Express, pas un intercepteur NestJS.** Un
intercepteur ne voit que les routes appariees, donc aucun 404, et ne voit pas le
statut final quand un filtre d'exception le reecrit. `res.on('finish')` mesure
jusqu'au dernier octet ecrit, ce qu'observe reellement l'utilisateur.

**`infra/prometheus/prometheus.yml` est genere** par `install.sh` depuis
`prometheus.yml.template`, parce que Prometheus ne substitue pas les variables
d'environnement dans sa configuration. Figer le port du backend a la place
creerait une derive silencieuse le jour ou `PORT_BACKEND` change : la cible
passerait DOWN et l'alerte crierait sur une fausse panne. Le fichier rendu est
ignore par git, le gabarit est la source de verite.

**`/api/metrics` n'est pas authentifie**, et c'est un choix : le backend
n'ecoute que sur `127.0.0.1`, et le proxy frontal refuse ce chemin depuis
l'exterieur (regle documentee dans `infra/nginx/README.md`). L'exposition se
joue au niveau reseau ; un secret de scrape en dur dans un fichier de
configuration n'aurait ajoute aucune securite reelle.

### Ecarts assumes

- **MinIO n'est pas scrape.** Ses metriques exigent
  `MINIO_PROMETHEUS_AUTH_TYPE=public` ou un jeton, et `/api/health/ready`
  distingue deja une panne de la base d'une panne du stockage. Ajoute si le
  temps le permet, pas avant.
- **Journaux non structures.** Le logger NestJS par defaut ecrit du texte sur la
  sortie standard, sans identifiant de correlation par requete. C'est un manque
  reel pour un diagnostic d'incident, non couvert par les 20 h.

---

## 10. Deploiement

Deploye et verifie sur **https://amar-idinarene.stage2-div.rayan-drissi.com**.

### Aucun code source sur le serveur

C'est une exigence du sujet, et elle est materialisee plutot que promise :
`infra/make-server-bundle.sh` fabrique le paquet a partir d'une **liste blanche
explicite**, puis verifie le resultat — presence de code source, de `backend/`,
de `frontend/`, de `node_modules`, de secrets non-placeholder. Une liste
d'exclusion aurait oublie le dossier ajoute six semaines plus tard.

Le serveur recoit **13 fichiers, 24 ko** :

```
docker-compose.prod.yml          aucune section `build:`, uniquement des `image:`
install.sh                       le seul executable
.env.prod.example                -> copie en .env, secrets generes sur place
infra/nginx/available/*.template bootstrap et production
infra/prometheus/*               gabarit de configuration + regles d'alerte
infra/grafana/*                  datasource et dashboard provisionnes
infra/minio/init.sh              creation du bucket prive
```

Le serveur ne compile rien, ne clone rien, n'installe aucun paquet npm.

### Images, construites ailleurs

```bash
# Sur le poste de developpement uniquement
docker build --platform linux/amd64 -t ghcr.io/amaridi/depot-backend:1.0.0  backend/
docker build --platform linux/amd64 -t ghcr.io/amaridi/depot-frontend:1.0.0 frontend/
docker push ghcr.io/amaridi/depot-backend:1.0.0
docker push ghcr.io/amaridi/depot-frontend:1.0.0
```

Le backend part de `node:22-bookworm-slim` et non d'Alpine : Prisma exige
OpenSSL 3.0, et sur musl le Query Engine reste introuvable jusqu'au premier
appel a la base. Les `node_modules` sont elagues dans l'etape de build puis
copies tels quels, avec le binaire natif d'argon2 deja compile pour cette base :
l'image finale n'accede jamais au reseau au demarrage. Le seed est compile en
JavaScript autonome, ce qui evite d'embarquer `ts-node`.

Aucun secret n'entre dans les images : ni `ARG`, ni `COPY .env`. Un secret pose
dans une couche y reste, meme supprime par une instruction ulterieure.

### Exposition

Le proxy frontal mutualise de la plateforme relaie le port 80 externe vers
`127.0.0.1:22400` et le port 443 vers `127.0.0.1:22401` **en passthrough SNI** :
c'est donc notre nginx qui termine TLS.

**Un seul service publie des ports** — nginx, sur la boucle locale. PostgreSQL,
MinIO, le backend, le frontend, Prometheus et Grafana n'en publient aucun : ils
ne sont joignables que par le reseau interne du compose. C'est plus strict que
l'exigence, et cela rend la base et le stockage inatteignables depuis l'hote
partage.

Le backend ecoute bien sur `0.0.0.0` **dans son conteneur** — sans quoi nginx ne
pourrait pas le joindre. Comme aucun port n'est publie, cette interface n'existe
que dans le namespace reseau du conteneur.

### Certificat TLS : la sequence en deux phases

Un bloc `ssl_certificate` pointant sur un fichier absent empeche nginx de
**demarrer**. Or le challenge HTTP-01 exige un nginx en marche. La sequence est
donc impossible sans amorcage, et `install.sh prod` l'enchaine seul :

1. nginx demarre avec `bootstrap.conf.template` — HTTP seul, servant le
   challenge ACME et rien d'autre ;
2. **repetition a blanc** (`certbot --dry-run`) : Let's Encrypt limite a cinq
   echecs par heure et par domaine, une configuration fautive bloquerait le
   deploiement pour une heure. Le dry-run valide exactement le meme chemin ;
3. emission du certificat reel ;
4. bascule sur `production.conf.template`, qui termine TLS et redirige HTTP vers
   HTTPS — **sauf `/.well-known/acme-challenge/`**. Cette exception n'est pas un
   detail : rediriger le challenge ferait echouer chaque renouvellement, soit
   une panne differee de trois mois.

**Renouvellement** : le conteneur `certbot` tente un `certbot renew` toutes les
12 h ; nginx recharge sa configuration toutes les 6 h, seul moyen pour lui de
prendre en compte un certificat renouvele depuis un autre namespace de
processus. Pas d'Alertmanager ni de cron systeme : tout vit dans le compose.

### Retour arriere

`IMAGE_TAG=<tag precedent> ./install.sh prod`. Les images sont taguees par
version, et `latest` suit la derniere publiee.

### Ecarts assumes

**Pas de pipeline CI.** Le sujet exige une image publiee sur un registre puis
tiree sur le serveur, ce qui est satisfait ; une GitHub Action serait un
confort, pas une exigence, pour environ deux heures et demie.

**Pas de sauvegardes automatisees.** `pg_dump` quotidien et `mc mirror` du
bucket seraient le premier ajout en exploitation reelle.

---

## 11. Charte graphique

La charte DIV Protocol est implementee une seule fois, en tokens, dans
[frontend/src/theme/index.ts](frontend/src/theme/index.ts). **Aucun composant
de l'application ne contient de valeur hexadecimale** : si la charte evolue, ce
fichier est le seul a modifier. Les composants s'expriment en tokens
semantiques (`fg.muted`, `bg.accent`, `border`) plutot qu'en couleurs, ce qui
maintient la conformite sans discipline permanente.

| Element | Valeur |
|---|---|
| Couleurs | primary `#5100FF`, secondary `#916ED8`, texte `#000000`, gris `#585858`, gris clair `#CECECE`, bordure `#E9E9E9`, fond accent `#F7F6FF`, accent doux `#DBCDFF` |
| Etats | succes `#12AC64` sur `#D9FFED`, danger `#FF4C4C` sur `#FFD0D0`, alerte `#DA9705` sur `#FFEDCA`, information `#52A0EE` sur `#DBEDFF` |
| Typographie | Inter, 400 pour le corps, 600 pour les titres et les CTA |
| Rayons | 4 px, 8 px, 12 px, et `999px` pour boutons et pills |
| Bouton primaire | fond primary, texte blanc, poids 600, padding 24 px / 14 px, rayon complet. Au survol : fond `#F7F6FF`, texte primary, contour inset 1 px |
| Cards | fond blanc, bordure 1 px `#E9E9E9`, rayon 12 px, sans ombre |
| Theme | light uniquement, aucun mode sombre |

Inter est empaquetee avec l'application (`@fontsource/inter`) : aucun appel a
un CDN de polices, donc aucune dependance externe a l'execution et aucune fuite
d'adresse IP des visiteurs.

Le contour du bouton au survol est un `box-shadow: inset` et non une bordure :
le bouton ne se decale donc pas d'un pixel au survol.

La page `/_charte` presente l'ensemble des tokens et sert de test de fumee du
systeme de design.

Ton editorial : formel, froid, technique, phrases courtes.

---

## 12. Perimetre assume

Ecarte volontairement, avec la raison :

| Ecarte | Raison |
|---|---|
| Journal d'audit persiste | Enjeu deontologique reel ; la table et un hook sur la confirmation suffiraient. Premier ajout en production. |
| Pipeline CI complete | Le sujet exige une image publiee et tiree, pas une pipeline. Build et push documentes. |
| Limitation de debit par IP | Le compteur de tentatives en base couvre la menace reelle (brute-force du PIN). La protection contre une attaque distribuee est hors perimetre. |
| Refresh token et revocation fine | Environ 2 h 30 de travail. Consequence assumee : un JWT vole reste valable 8 h. |
| Notifications par courriel | L'avocat copie le lien et le PIN depuis l'interface. Zero dependance externe pendant la demonstration. |
| Antivirus sur les fichiers deposes | Point d'extension prevu sur la confirmation. |
| Multi-cabinet, signature electronique, OCR | Hors sujet. |

---

## 13. Journal des conversations IA

Les sessions d'assistance IA sont exportees dans [ai-logs/](ai-logs/), un
fichier par session, sans retouche.
