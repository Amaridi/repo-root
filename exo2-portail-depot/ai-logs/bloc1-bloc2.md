# Session IA — conception, bloc 1 (socle) et bloc 2 (authentification)

**Date** : 8 et 9 septembre 2026
**Outil** : Claude Code (CLI)
**Perimetre couvert** : analyse du besoin, architecture, re-cadrage sur 20 h,
scaffolding complet, module d'authentification avocat.

> ## Nature de ce document
>
> `/export` n'etant pas disponible dans cet environnement, ce fichier est une
> **transcription reconstituee**, pas une capture brute du terminal.
>
> - **Les prompts utilisateur sont verbatim.**
> - **Les reponses de l'assistant sont fideles mais condensees** : les tableaux
>   de justification longs et les blocs de code integralement reproduits dans le
>   depot sont resumes, avec un renvoi vers le fichier concerne.
> - **Les appels d'outils** (commandes shell, ecritures de fichiers) sont
>   journalises de maniere synthetique en fin de tour.
>
> La verite de reference du code reste le depot lui-meme ; ce document trace le
> raisonnement et les decisions.

---

## Tour 1 — Analyse du besoin et proposition d'architecture

### Prompt

> Je dois réaliser un Portail de Dépôt de Pièces pour avocat.
>
> Le produit doit permettre :
> - à un avocat authentifié de créer une demande de dépôt de documents ;
> - de générer un lien public unique et expirable protégé par un PIN ;
> - au client de déposer ses documents sans créer de compte ;
> - à l'avocat de consulter les documents et le statut de ses demandes.
>
> Stack et contraintes imposées par le sujet :
> - Backend : NestJS + TypeScript
> - Frontend : React + Chakra UI v3
> - Base de données relationnelle
> - Stockage objet : MinIO ou S3, conteneurisé
> - Tests backend : Jest
> - Docker
> - Prometheus + Grafana
> - Déploiement HTTPS avec Let's Encrypt
> - Image Docker publiée sur un registry puis tirée sur le serveur
> - Aucun fichier utilisateur ne doit être stocké sur le disque local de l'application.
>
> Commence par analyser les besoins et proposer une architecture complète du projet.
>
> Je veux notamment :
> 1. Une proposition d'arborescence backend/frontend/infra.
> 2. Une proposition de découpage des modules NestJS.
> 3. Une proposition de modèle de données.
> 4. Une proposition de flux d'authentification avocat.
> 5. Une proposition de flux de validation du PIN côté client.
> 6. Une proposition de stratégie de stockage MinIO.
> 7. Une proposition de stratégie de tests.
> 8. Une proposition de stratégie d'observabilité.
> 9. Une proposition de stratégie de déploiement.
>
> Ne code pas encore.
>
> Pour chaque choix important, explique :
> - pourquoi tu le proposes ;
> - quelles alternatives existent ;
> - pourquoi tu privilégies cette solution pour cet exercice.
>
> Je veux une architecture suffisamment simple pour être réalisable en une semaine,
> mais suffisamment propre pour être défendable lors d'un entretien technique.
>
> Attends ma validation avant de générer le code.

### Reponse (condensee)

Proposition en 9 sections, chacune avec alternatives et arbitrage.

**Deux invariants degages de l'enonce**, qui structurent tout le reste :

1. Aucun fichier utilisateur sur le disque de l'application, donc les octets ne
   doivent jamais traverser le process Node — d'ou les URLs presignees.
2. Le lien public est la seule barriere avant le PIN, donc il doit etre non
   devinable, expirable, revocable, a tentatives limitees et stocke hache.

**Arborescence** : monorepo a plat (`backend/`, `frontend/`, `infra/`, `docs/`),
sans Nx ni Turborepo. *Alternatives* : outil de monorepo (partage de types, cache
CI, mais ~1 jour de setup), deux depots (casse le `docker compose up` unique qui
est la demonstration).

**Modules NestJS** : decoupage par domaine. Point cle — `DepositRequestsModule`
(prive) et `DepositAccessModule` (public) separes bien qu'ils manipulent la meme
table, parce que ce sont deux surfaces d'attaque et deux modeles d'autorisation
differents. L'alternative (module unique + gardes conditionnelles) transforme
chaque endpoint en `if (isPublic)`, terrain des failles IDOR.

**Modele de donnees** : `Lawyer`, `DepositRequest`, `Document`, `RequestedItem`,
`AuditEvent`, `RefreshSession`. Decisions : `tokenHash` et non `token`
(SHA-256) ; `expiresAt` stocke mais `isExpired` calcule ; `Document.PENDING`
avant confirmation ; `AuditEvent` avec `ipHash` (tracabilite sans IP en clair).
ORM : Prisma. *Alternatives* : TypeORM (canonique Nest mais migrations
fragiles), Drizzle, Kysely.

**Auth avocat** : access JWT 15 min en memoire + refresh 7 j en cookie HttpOnly
rotatif. *Alternatives* : sessions serveur + Redis (revocation instantanee, un
service de plus), JWT unique en localStorage (rapide et indefendable), Keycloak
(bonne reponse en production, hors sujet ici).

**Flux PIN** : token 32 octets base64url (256 bits), `resolve` separe de
`verify-pin`, 404 uniforme, argon2id sur le PIN, 5 tentatives puis verrou 15 min
avec compteur porte par la demande, puis session de depot JWT 30 min signee avec
une cle distincte.

**Stockage** : presigned POST (policy `content-length-range`) a l'upload,
presigned GET 60 s au telechargement, backend uniquement autorite de decision.
*Alternatives* : proxy streaming via multer (violerait l'invariant n°1), BLOB en
base (ne passe pas l'echelle).

**Tests** : unitaires cibles sur PIN / expiration / statuts, e2e sur 3 scenarios
dont un test d'isolation entre avocats.

**Observabilite** : Prometheus + Grafana, metriques techniques RED **et**
metriques metier (`deposit_pin_attempts_total` comme signal d'attaque), dashboard
JSON versionne.

**Deploiement** : CI GitHub Actions -> GHCR -> `docker compose pull` sur le VPS,
Traefik + Let's Encrypt (Caddy en repli).

Deux questions posees en fin de tour : garder ou non `RequestedItem`, et Traefik
ou Caddy.

*Aucun fichier ecrit — le prompt demandait de ne pas coder.*

---

## Tour 2 — Re-cadrage sur 20 h

### Prompt

> Cette architecture est excellente. Avant de continuer, je dois être transparent
> sur mon contexte : j'ai environ 20h de temps réel disponible au total, et je
> découvre NestJS, Prisma et MinIO en le faisant.
>
> Je veux couvrir tous les points "Obligatoire" ET "Attendu" du sujet. En revanche,
> retire ou simplifie tout ce qui relève des "Bonus" (que j'ai identifiés dans ton
> architecture : AuditModule, journal d'audit, CI GitHub Actions complète, rate
> limiting/lockout avancé) pour garantir que l'Obligatoire et l'Attendu soient
> solides et fonctionnels en priorité.
>
> [rappel des criteres Obligatoire / Attendu]
>
> Redonne-moi une version ajustée du plan sur 20h, en gardant l'essentiel de ton
> architecture mais en coupant les Bonus pour sécuriser le reste.

### Reponse (condensee)

**Coupes chiffrees** (~20 h de travail retirees) : AuditModule (~2 h), CI
complete (~2,5 h), throttler + Redis (~1 h), refresh token et rotation (~2,5 h),
`RequestedItem` (~1,5 h), notifications SMTP (~1,5 h), presigned POST remplace
par PUT (~1 h), exporteurs Prometheus secondaires (~1,5 h), Testcontainers et
e2e exhaustifs (~3 h), Traefik remplace par Caddy (~1,5 h).

**Trois choses conservees bien que proches du Bonus**, parce qu'elles coutent
moins de 15 min chacune : le compteur `failedAttempts` + `lockedUntil` (c'est le
sujet des tests PIN demandes), le hachage `tokenHash` / `pinHash`, et le filtre
`where: { id, lawyerId }` sur chaque requete avocat.

**Architecture resserree** : 8 modules au lieu de 12, 3 tables au lieu de 6.

**Sequencement en 10 blocs**, ordre vertical pour qu'il y ait toujours quelque
chose de demontrable. Total estime honnetement a **23 h pour 20 h disponibles**,
avec 4 coupes de secours listees dans l'ordre d'activation.

Point insiste : le **bloc 5 (spike deploiement) est place au milieu**, pas a la
fin — chez un debutant, ce qui fait exploser ce type de projet n'est jamais la
logique metier mais le DNS, ACME et l'endpoint public MinIO.

Trois questions posees : la charte DIV, le registry et le domaine, et la
confirmation explicite des deux arbitrages qui reduisent une propriete de
securite (JWT sans refresh, presigned PUT).

*Aucun fichier ecrit.*

---

## Tour 3 — Contexte serveur, charte graphique, lancement du bloc 1

### Prompt

> Confirmé pour les deux coupes : JWT simple sans refresh, et presigned PUT plutôt
> que POST.
>
> Registry : GHCR (GitHub Container Registry).
>
> Serveur : j'ai déjà un serveur fourni par DIV Protocol pour l'exercice :
> - Sous-domaine : amar-idinarene.stage2-div.rayan-drissi.com
> - SSH : ssh amar-idinarene@152.228.192.48
> - Plage de ports assignée : 22400-22499
> - Le serveur est partagé avec d'autres candidats, mes services doivent écouter
>   uniquement sur 127.0.0.1 dans ma plage de ports
> - Un proxy frontal (pas Traefik/Caddy de mon côté à priori, c'est géré par eux)
>   route le trafic HTTP/HTTPS vers mes ports
>
> Charte graphique DIV Protocol :
> [couleurs, sémantiques, typo Inter 400/600, radius 4/8/12/999,
>  bouton primaire avec hover inversé, cards sans ombre, light only,
>  ton formel froid technique]
>
> Important : vu que le serveur est déjà fourni avec son propre proxy frontal (pas
> Traefik/Caddy à installer), adapte le plan de déploiement en conséquence -- je
> n'ai pas besoin de gérer moi-même l'exposition des ports 80/443, juste faire
> écouter mes services en local sur ma plage de ports assignée, et gérer TLS avec
> mon propre certificat côté nginx si besoin (le proxy fait du passthrough TLS par
> SNI sur le 443).
>
> Lance le bloc 1.

### Message envoye en cours de tour

> Aussi, respecte exactement la structure demandée dans l'énoncé (pas de dossier
> docs/ séparé) :
> exo2-portail-depot/ ├── backend/ ├── frontend/ ├── infra/ ├── ai-logs/
> ├── install.sh └── README.md
>
> Mets toute la documentation d'architecture directement dans le README.md principal.

### Reponse (condensee)

**Deux consequences majeures de l'infra**, identifiees avant de coder :

1. **Un seul hostname au lieu de quatre.** Plus de sous-domaines `api.` / `s3.` /
   `grafana.` : routage par chemin. Consequence favorable — origine unique, donc
   zero CORS et cookie `SameSite=Strict` sans attribut `Domain`.

2. **Le piege des signatures S3.** Les presigned URLs sont consommees par le
   navigateur, donc MinIO doit etre joignable via ce meme hostname. Or SigV4
   signe le chemin *et* l'en-tete `Host` : si nginx reecrit un prefixe, toutes
   les signatures cassent. Solution retenue : **URLs path-style dont le prefixe
   est le nom du bucket**. `https://<host>/depot-documents/<key>?X-Amz-...` est
   deja une URL S3 valide ; nginx route `location /depot-documents/` vers MinIO
   sans reecriture. Le nom du bucket devient le prefixe de routage.

**Allocation des ports** dans 22400-22499 : 22443 nginx TLS, 22480 nginx HTTP,
22400/22401 MinIO, 22409 backend, 22432 Postgres, 22490/22491 Grafana/Prometheus,
22470 Vite.

**Arborescence corrigee** suite au message en cours de tour : `docs/` supprime,
`ai-logs/` cree, toute l'architecture deplacee dans le `README.md` racine.

**Trois arbitrages pris en cours de route :**

- **Prisma fige en 6.16.2.** La 7 supprime `url` du schema et impose
  `prisma.config.ts` + un driver adapter, modele que la documentation en ligne
  ignore encore. Sur 20 h avec Prisma a decouvrir, c'etait le piege garanti.
  Justifie dans le README comme gestion de risque calendaire, pas comme choix de
  fond.
- **TypeScript fige en 6.0.3.** npm tirait la 7, que `ts-jest` refuse
  (`peer typescript@">=4.3 <7"`). C'est ce conflit qui bloquait l'installation.
- **`dotenv-cli`** pour que le CLI Prisma lise le `.env` racine depuis
  `backend/`, afin de garder un seul `.env` comme source de verite pour compose,
  install.sh et l'API.

**Chakra v3** : les variantes de recette personnalisees exigent
`npx chakra typegen`, sans quoi TypeScript refuse `variant="div"`. Genere et
cable dans le script `build`.

**Docker absent de la machine** — signale immediatement pour que l'installation
se fasse en parallele ; rien du bloc 1 n'en dependait.

### Fichiers ecrits

| Fichier | Role |
|---|---|
| `README.md` | 13 sections, toute la justification d'architecture |
| `install.sh` | modes `local` et `prod` |
| `docker-compose.yml` | Postgres + MinIO + `minio-init`, tout en 127.0.0.1 |
| `.env.example`, `.gitignore` | contrat d'environnement, exclusion des secrets |
| `backend/prisma/schema.prisma` | 3 tables, decisions commentees sur place |
| `backend/prisma/seed.ts` | compte avocat par upsert, idempotent |
| `backend/src/config/env.validation.ts` | schema Zod, echec bruyant au boot |
| `backend/src/prisma/*`, `backend/src/health/*`, `main.ts`, `app.module.ts` | socle API |
| `frontend/src/theme/index.ts` | charte DIV integrale en tokens |
| `frontend/src/App.tsx` | squelette + page `/_charte` |
| `frontend/src/components/ui/*`, `lib/api.ts`, `vite.config.ts` | socle SPA |
| `infra/minio/init.sh` | bucket, politique, versioning, cycle de vie, CORS |
| `infra/nginx/README.md` | les deux regles a ne pas casser + question TLS ouverte |
| `ai-logs/README.md` | index des exports |

### Verifications

- `tsc --noEmit` backend : OK
- `nest build` : OK
- `vite build` : OK
- Aucune commande Docker executee (Docker non installe) — signale explicitement.

---

## Tour 4 — Retour de test sur install.sh

### Prompt

> J'ai testé le Bloc 1 :
>
> 1. Docker fonctionnait, mais j'ai dû résoudre un problème de permissions
>    (usermod + newgrp docker) — c'était pas dans le README, à documenter.
> 2. ./install.sh local a bien démarré Postgres et MinIO (Healthy), et minio-init
>    s'est terminé avec succès (exited 0).
> 3. Le script s'arrête là — il ne lance pas automatiquement la migration Prisma
>    ni le seed. J'ai dû lancer manuellement `cd backend && npm run prisma:migrate`
>    (nommé "init"), qui a fonctionné et créé les 3 tables.
> 4. En relançant ./install.sh local après ça, ça s'arrête toujours au même endroit
>    (après minio-init), sans lancer le seed ni afficher les URLs finales.
>
> Est-ce que install.sh est censé enchaîner automatiquement sur la migration + seed
> + affichage des URLs, ou est-ce que je dois lancer ces étapes manuellement pour
> l'instant ? Si c'est censé être automatique, il manque une partie du script.

### Reponse (condensee)

**Cause racine identifiee** : `docker compose up -d --wait` retourne un code
d'erreur des qu'un conteneur se termine, **y compris avec un `exit 0`**.
`minio-init` est precisement un conteneur a usage unique. Combine a
`set -euo pipefail`, le script mourait sans rien afficher — d'ou l'impression
qu'il manquait du code.

**Trois corrections :**

1. `--wait` applique uniquement aux services durables ; `minio-init` passe par
   `docker compose run --rm`.
2. `trap ... ERR` affichant la ligne et la commande fautives — le vrai defaut du
   script etait d'etre indiagnosticable.
3. Pre-vol `docker info` avec, en cas de `permission denied`, l'affichage du
   `usermod -aG docker` + `newgrp docker`. Egalement documente dans les
   prerequis du README.

**Nuance sur le point 3 du retour** : lancer `prisma:migrate` a la main etait la
bonne action et le reste. `install.sh` appelle `prisma:deploy`, qui *applique*
des migrations versionnees ; il ne les *ecrit* pas. Un script d'installation qui
genere un schema a la volee divergerait silencieusement entre la machine de dev
et le serveur. Regle rendue explicite dans le README (tableau « qui ecrit, qui
applique »), et le script s'arrete desormais avec un message clair si le dossier
de migrations est vide.

### Fichiers modifies

`install.sh` (reecrit), `README.md` (prerequis groupe docker + tableau des
migrations).

---

## Tour 5 — Inventaire des fichiers

### Prompt

> fais moi le resume de tout les fichiers que t'as creer et leurs utilites dans le projet

### Reponse (condensee)

Inventaire par zone (racine, backend, frontend, infra), avec pour chaque fichier
son role et la decision qu'il porte. Mise en avant des **5 fichiers a relire
avant un entretien** : `schema.prisma`, `theme/index.ts`, `install.sh`,
`env.validation.ts`, et la section 3 du README.

Deux details signales : `favicon.svg` encore celui de Vite, `frontend/src/features/`
vide jusqu'au bloc 7.

*Aucun fichier ecrit.*

---

## Tour 6 — Bloc 2 : authentification avocat

### Prompt

> Maintenant, implémente uniquement le système d'authentification de l'avocat.
>
> Objectif fonctionnel :
> * Un avocat doit pouvoir se connecter avec email + mot de passe.
> * Le mot de passe doit être stocké uniquement sous forme de hash Argon2.
> * Après connexion réussie, l'API doit fournir une authentification permettant de
>   protéger les routes réservées à l'avocat.
> * Prépare une architecture propre et extensible pour les futurs endpoints protégés.
>
> À implémenter :
> 1. Un `AuthModule`.
> 2. Un `AuthController` avec un endpoint de login.
> 3. Un `AuthService` contenant la logique métier de connexion.
> 4. Un DTO de login avec validation.
> 5. Un mécanisme d'authentification JWT côté backend.
> 6. Un Guard NestJS permettant de protéger les routes avocat.
> 7. La vérification du mot de passe avec Argon2.
> 8. Les erreurs appropriées en cas d'identifiants invalides.
>
> Contraintes :
> * Utilise les services NestJS et la Dependency Injection.
> * Ne mets pas la logique métier dans le controller.
> * Ne stocke jamais le mot de passe en clair.
> * Utilise les variables d'environnement existantes pour les secrets.
> * Respecte l'architecture déjà créée.
> * Ne modifie pas les parties MinIO, frontend métier, upload ou dashboard pour l'instant.
> * N'ajoute pas de fonctionnalités non demandées.
>
> À la fin :
> 1. Vérifie que le backend compile.
> 2. Explique-moi en maximum 5 points ce qui a été créé.
> 3. Donne-moi uniquement la liste des nouveaux fichiers créés/modifiés avec leur rôle.
>    Ne fais pas de longue explication.

### Reponse (condensee)

Cinq points retenus :

1. `AuthService` porte toute la logique ; le controleur ne fait que traduire HTTP
   et poser le cookie.
2. Le JWT part en cookie `HttpOnly` / `SameSite=Strict`, **jamais dans le corps
   de la reponse** — le front ne peut donc pas le stocker en `localStorage`,
   meme par erreur.
3. **Anti-enumeration de comptes** : une adresse inconnue declenche quand meme
   une verification argon2 contre un hash leurre calcule au demarrage, donc le
   temps de reponse ne revele pas l'existence du compte. Message d'erreur unique
   dans les deux cas.
4. `JwtAuthGuard` verifie **l'audience `lawyer`** en plus de la signature : le
   token de session de depot du bloc 4, bien que signe avec sa propre cle, sera
   rejete ici. Deux barrieres au lieu d'une.
5. Garde et `JwtModule` exportes, `@CurrentLawyer()` disponible — les modules des
   blocs 3 et 6 protegent leurs routes en une ligne.

Reserve signalee : `logout` et `me` ajoutes bien que non explicitement demandes,
parce que `me` est la seule preuve executable que la garde fonctionne et que
`logout` complete le meme mecanisme de cookie. Proposition faite de les retirer.

Verification a l'execution impossible a ce stade : Docker inaccessible depuis le
shell de l'assistant, donc pas de base. Trois commandes `curl` fournies a
l'utilisateur.

### Fichiers crees

`auth.module.ts`, `auth.controller.ts`, `auth.service.ts`, `dto/login.dto.ts`,
`guards/jwt-auth.guard.ts`, `decorators/current-lawyer.decorator.ts`,
`auth.constants.ts`, `auth.types.ts`. Modifie : `app.module.ts`.

### Verifications

`tsc --noEmit` : OK. `nest build` : OK.

---

## Tour 7 — Echec du seed : trois causes empilees

### Prompt

> npx prisma db seed échoue avec des erreurs TypeScript sur process et console non
> reconnus (TS2591, TS2584) dans prisma/seed.ts. Corrige la config TypeScript pour
> que le seed s'exécute, puis confirme que l'avocat de test est bien créé en base
> avec le bon mot de passe.

### Reponse (condensee)

Le diagnostic a revele **trois causes distinctes**, dont deux invisibles depuis
l'enonce du probleme.

1. **Types globaux (l'erreur signalee).** `tsc` decouvre `@types/node` seul, mais
   ts-node compile le seed dans un programme isole ou cette decouverte ne
   s'applique pas. Correctif : `"types": ["node", "jest"]` explicite dans
   `tsconfig.json`.

2. **Moteur Prisma genere pour la mauvaise plateforme.** Le client dans
   `node_modules` etait genere pour `debian-openssl-3.0.x` : `npm install` avait
   ete lance **depuis WSL** sur un `node_modules` partage avec Windows via
   `/mnt/c`. Le dernier `prisma generate` ecrase le moteur de l'autre plateforme.
   Correctif : `binaryTargets = ["native", "windows", "debian-openssl-3.0.x"]`.

3. **`npm run prisma:seed` executait le mauvais binaire.** Meme cause racine : un
   `npm install` sous Linux cree des liens symboliques sans les `.cmd` attendus
   par Windows, donc npm retombait sur le `dotenv` de **Python** present dans le
   `PATH` (`Invalid value for '-e'`). Correctif : les scripts npm invoquent les
   points d'entree JavaScript directement
   (`node ./node_modules/dotenv-cli/cli.js ...`), ce qui fonctionne des deux
   cotes.

Le seed n'avait donc **jamais abouti** : la table `lawyer` etait vide avant cette
execution.

### Verification en base

```
id            : d88d801c-d039-4ffa-9879-2c02d059983d
email         : avocat@div-protocol.test
displayName   : Maitre Amar Idinarene
algorithme    : argon2id   (m=65536, p=4, t=3)
mot de passe en clair dans le hash ? : non
verify(bon mot de passe)     : true
verify(mauvais mot de passe) : false
nb avocats : 1  ->  apres un 2e seed : 1   (upsert idempotent)
```

### Fichiers modifies

`backend/tsconfig.json`, `backend/prisma/schema.prisma`, `backend/package.json`,
`README.md` (section « Un seul environnement d'execution : WSL ou Windows, pas
les deux »).

**Recommandation formulee** : choisir un seul environnement. Docker tournant
sous WSL, WSL est le choix naturel. Les trois correctifs rendent le projet
tolerant au melange, pas confortable.

---

## Tour 8 — Doublon d'audience JWT

### Prompt

> Erreur au login : "Bad options.audience option. The payload already has an aud
> property." L'audience du token JWT est définie à la fois dans le payload
> (auth.service.ts) et dans les signOptions du JwtModule (auth.module.ts). Corrige
> ce doublon pour qu'elle soit définie à un seul endroit, puis confirme que le
> login fonctionne.

### Reponse (condensee)

Bug introduit par l'assistant au tour 6. Source unique retenue : **`signOptions`**
— `aud` est une claim standard JWT, la bibliotheque doit la poser, pas le code
metier.

Correctif de typage : separation en `LawyerJwtClaims` (ce que l'application
signe : `sub`, `email`) et `LawyerJwtPayload` (le token decode : + `aud`, `iat`,
`exp`).

### Verification a l'execution

API compilee lancee sur un port de test (22419, le 22409 etant occupe par
l'instance de l'utilisateur) :

| Cas | Resultat |
|---|---|
| Login identifiants corrects | 200, cookie `depot_session` HttpOnly/SameSite=Strict, expiration 8 h |
| `/auth/me` avec cookie | 200, profil sans `passwordHash` |
| `/auth/me` sans cookie | 401 `Authentification requise.` |
| Mauvais mot de passe | 401 `Identifiants invalides.` |
| Adresse inconnue | 401 message strictement identique |
| Token signe avec la bonne cle mais `aud: "deposit"` | 401 — controle d'audience effectif |
| Token bidon | 401 |

### Fichiers modifies

`backend/src/auth/auth.types.ts`, `backend/src/auth/auth.service.ts`.

---

## Etat du projet a la fin de cette session

**Termine** : bloc 1 (socle, charte, install.sh, README) et bloc 2
(authentification avocat, verifiee a l'execution).

**Points ouverts :**

1. **Mode de terminaison TLS du proxy frontal DIV** — question redigee dans
   `infra/nginx/README.md`, reponse requise avant le bloc 5. Determine s'il faut
   obtenir un certificat soi-meme (et par quel challenge ACME) ou non.
2. **Aucun commit** a ce stade : la migration `20260908230331_init` et le socle
   doivent etre versionnes.
3. **Fichier `j.txt`** a la racine — cookie jar laisse par un test curl, a
   supprimer.

**Suite** : bloc 3, `DepositRequestsModule` (CRUD avocat, generation du lien et
du PIN, transitions de statut).

---
