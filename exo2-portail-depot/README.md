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

---

## Sommaire

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
proxy frontal ── 22443 ───┼─ /api/*              -> backend NestJS
   (443, SNI)   nginx     ├─ /depot-documents/*  -> MinIO (presigned PUT / GET)
                          └─ /grafana/*          -> Grafana
                                │
                    reseau interne : PostgreSQL, Prometheus (jamais exposes)
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

| Port | Service | Expose |
|---|---|---|
| 22443 | nginx HTTPS | 127.0.0.1 (cible du proxy frontal) |
| 22480 | nginx HTTP | 127.0.0.1 |
| 22409 | backend NestJS | 127.0.0.1 |
| 22432 | PostgreSQL | 127.0.0.1 (developpement uniquement) |
| 22400 / 22401 | MinIO API / console | 127.0.0.1 |
| 22490 / 22491 | Grafana / Prometheus | 127.0.0.1 |
| 22470 | Vite dev server | 127.0.0.1 (developpement uniquement) |

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

Jest, tests unitaires a dependances mockees, concentres sur ce qui est risque.

| Cible | Cas couverts |
|---|---|
| Expiration des liens | lien valide, lien expire, calcul de `expiresAt` a la creation |
| Verification du PIN | PIN correct, PIN faux, incrementation du compteur, verrou au 5e echec, verrou encore actif, verrou expire puis nouvelle tentative |
| Transitions de statut | `PENDING` vers `IN_PROGRESS` vers `SUBMITTED` vers `CLOSED`, et refus des transitions illegales |
| Appartenance | un avocat ne peut ni lire ni modifier la demande d'un autre |
| Generation du secret | entropie du token, jamais persiste en clair |

**Ce qui n'est pas teste, volontairement** : les controleurs triviaux, les DTO
(deja garantis par `class-validator`), le frontend. Le seuil de couverture ne
porte que sur les modules metier, pas globalement : un pourcentage moyen ne dit
rien, alors que « six tests sur le brute-force du PIN et un sur l'isolation
entre avocats » decrit des menaces.

Testcontainers et une suite end-to-end complete auraient de la valeur ; ils
sont hors du budget de vingt heures et cites comme etape suivante.

---

## 9. Observabilite

```
backend --/api/metrics--> Prometheus --> Grafana
   (prom-client)                          (datasource et dashboard provisionnes,
                                           versionnes dans infra/grafana/)
```

Metriques techniques : `http_request_duration_seconds` (histogramme, avec la
route **templatisee** et jamais l'URL brute, qui contiendrait les tokens de
depot), `http_requests_total`, metriques de process.

Metriques metier — c'est la que l'observabilite sert le produit :

| Metrique | Ce qu'elle raconte |
|---|---|
| `deposit_requests_created_total` | usage |
| `deposit_pin_attempts_total{result}` | **signal d'attaque** : un pic d'echecs est un brute-force |
| `deposit_requests_locked_total` | verrous declenches |
| `documents_uploaded_total`, `document_size_bytes` | volumetrie et dimensionnement du stockage |
| `deposit_submission_duration_seconds` | delai creation vers soumission, la vraie mesure de valeur |

Une regle d'alerte : taux d'erreur 5xx superieur a 5 % pendant 5 minutes.
Le dashboard Grafana est un fichier JSON versionne et provisionne au demarrage,
jamais une configuration cliquee dans l'interface — sinon elle disparait au
premier `docker compose down -v`.

Journaux au format JSON sur la sortie standard, avec un identifiant de
correlation par requete.

---

## 10. Deploiement

Aucun code source sur le serveur. Le serveur ne recoit que des fichiers de
configuration ; les artefacts viennent du registry.

```
Poste de developpement
  docker build -t ghcr.io/<owner>/depot-backend:<sha>  backend/
  docker build -t ghcr.io/<owner>/depot-frontend:<sha> frontend/
  docker push ...

Serveur (5 fichiers, aucun clone git, aucun build)
  docker-compose.prod.yml     images ghcr.io/...:<sha>, jamais de section build
  .env                        secrets, hors depot, chmod 600
  infra/nginx/nginx.conf
  infra/prometheus/prometheus.yml
  infra/grafana/provisioning/

  ./install.sh prod
    -> docker compose pull
    -> migrations jouees PAR l'image du backend
    -> docker compose up -d --wait
    -> affichage des URLs
```

Retour arriere : `IMAGE_TAG=<sha precedent> ./install.sh prod`. C'est le
benefice direct du tag par SHA.

**Exposition et TLS.** Les services ecoutent uniquement sur `127.0.0.1`, dans
la plage `22400-22499`. Le proxy frontal mutualise du serveur d'exercice
achemine le trafic public vers `127.0.0.1:22443`. Aucun Traefik ni Caddy n'est
installe : ce serait un second proxy redondant avec celui de la plateforme. Le
mode de terminaison TLS retenu et le renouvellement automatique du certificat
sont documentes dans `infra/nginx/`.

**Integration continue.** Le build et la publication des images sont faits en
ligne de commande et documentes, pas dans une pipeline. Le sujet demande une
image publiee sur un registry puis tiree sur le serveur, ce qui est satisfait ;
une pipeline GitHub Actions serait un confort, non une exigence, et
representait environ deux heures et demie.

**Sauvegardes** : `pg_dump` quotidien et `mc mirror` du bucket vers un
emplacement distinct, avec une restauration testee une fois.

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
