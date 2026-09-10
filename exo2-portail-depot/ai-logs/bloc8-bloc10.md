# Session IA — bloc 8 (observabilite), bloc 9 (tests), bloc 10 (deploiement) et controle final

**Date** : 9 et 10 septembre 2026
**Outil** : Claude Code (CLI)
**Perimetre couvert** : instrumentation Prometheus et provisionnement Grafana,
puis extension de la couverture Jest, puis construction des images, publication
sur GHCR et deploiement HTTPS en production, enfin l audit complet avant rendu.

> ## Nature de ce document
>
> `/export` n etant pas disponible dans cet environnement, ce fichier est une
> **transcription reconstituee**, pas une capture brute du terminal.
>
> - **Les prompts utilisateur sont verbatim.** Le prompt du controle final est
>   tres long : sa structure est integralement conservee, les enumerations les
>   plus longues sont abregees et l elision est signalee par `[...]`.
> - **Les reponses de l assistant sont fideles mais condensees** ; le code
>   integralement present dans le depot est resume, avec renvoi au fichier.
> - **Les sorties de commandes sont reproduites telles qu obtenues.**
> - **Tous les secrets sont remplaces par `[REDACTED]`.** Les mots de passe
>   affiches par `install.sh` pendant les tests, les empreintes de secrets et les
>   jetons de lien de depot n apparaissent nulle part.
>
> Suite de `bloc1-bloc2.md`, `bloc3-bloc4.md`, `bloc5.md` et `bloc6-bloc7.md`.

---

## Tour 1 — Bloc 8 : observabilite

### Prompt

> Maintenant, ajoute l'observabilité demandée par le cahier des charges.
>
> Objectif :
> - exposer des métriques Prometheus depuis le backend NestJS ;
> - permettre à Prometheus de les scraper ;
> - provisionner Grafana automatiquement ;
> - fournir au moins une alerte réellement utile.
>
> Contraintes :
> - ne refactore pas massivement le projet ;
> - utilise les outils/dépendances déjà présents si possible ;
> - tout doit être intégré au Docker Compose ;
> - Prometheus et Grafana doivent rester sur les ports alloués au projet ;
> - en production, les services ne doivent pas être exposés inutilement sur 0.0.0.0 ;
> - le provisioning doit fonctionner automatiquement via install.sh.
>
> À implémenter au minimum :
>
> 1. Endpoint `/api/metrics` exposé par NestJS.
> 2. Métriques HTTP pertinentes : nombre de requêtes ; durée des requêtes ;
>    statut HTTP ; route/méthode sans créer de labels à forte cardinalité.
> 3. Quelques métriques métier utiles, par exemple : demandes créées ; dépôts
>    soumis ; échecs de vérification PIN ; uploads confirmés / erreurs d'upload.
> 4. Prometheus : configuration de scrape du backend ; vérification que la target est UP.
> 5. Grafana : datasource Prometheus provisionnée automatiquement ; au moins un
>    dashboard provisionné automatiquement avec quelques métriques utiles.
> 6. Alerting : ajoute au moins une alerte réellement pertinente. Exemple
>    acceptable : backend indisponible ; taux élevé d'erreurs HTTP 5xx. Choisis
>    celle qui a le plus de sens ici et justifie-la.
> 7. Docker Compose / install.sh : Prometheus + Grafana démarrent automatiquement ;
>    provisioning automatique ; aucune étape manuelle après installation.
>
> Tests à effectuer réellement : `/api/metrics` retourne les métriques ;
> Prometheus voit le backend en UP ; Grafana voit Prometheus comme datasource ;
> le dashboard est provisionné ; l'alerte existe et peut être évaluée ;
> backend/frontend compilent toujours.
>
> Ne crée pas 15 métriques décoratives. Le cahier des charges précise qu'une
> métrique et une alerte pertinentes valent mieux que beaucoup de dashboards inutiles.

### Reponse (condensee)

**Six metriques applicatives, pas quinze.** Critere retenu : une metrique doit
changer une decision.

| Metrique | Type | Ce qu elle permet de decider |
|---|---|---|
| `http_requests_total{method,route,status}` | compteur | reperer une route qui se degrade, calculer un taux d erreur |
| `http_request_duration_seconds{method,route}` | histogramme | latence p95 ; bornes calees sur ce service (argon2 ~100 ms) |
| `deposit_requests_created_total` | compteur | activite des avocats |
| `deposit_submissions_total` | compteur | la mesure de valeur : un depot soumis est un dossier recu |
| `deposit_pin_verifications_total{outcome}` | compteur | `success`/`invalid`/`locked` : signal d abus, et denominateur |
| `document_uploads_total{outcome}` | compteur | `confirmed`/`rejected`/`failed` |

**La decision structurante : le libelle `route` est le GABARIT de route.** Une
URL de depot contient le token d acces. L utiliser comme libelle creerait une
serie temporelle par demande *et* divulguerait les tokens a quiconque lit
`/api/metrics`. Les valeurs observees sont de la forme
`/api/public/deposits/:token/verify-pin`. Les requetes non appariees sont
etiquetees `unmatched` : sans ce repli, un robot testant mille chemins creerait
mille series permanentes.

**Middleware Express plutot qu intercepteur NestJS** : un intercepteur ne voit
pas les 404, ni le statut final quand un filtre d exception le reecrit.
`res.on('finish')` mesure jusqu au dernier octet ecrit.

**L alerte principale : `BackendIndisponible`** (`up == 0` pendant 1 min,
severite critique). Justification tiree du produit : ici l indisponibilite est
irreversible — le client a un lien a duree limitee et cinq essais de code, s il
tombe sur une erreur il abandonne et l avocat rate une echeance. `up` est
produit par Prometheus, pas par l application : c est la seule mesure qui reste
vraie quand le service ne repond plus.

Deux regles completent, une par famille de panne : `TauxErreursServeurEleve`
(> 5 % de 5xx pendant 10 min, **avec un garde-fou de trafic** — sur un service
peu sollicite, un ratio nu declencherait une alerte critique pour une seule
requete en erreur) et `RafaleDeCodesInvalides` (le verrouillage protege chaque
demande separement, il est aveugle a un balayage reparti sur mille liens).

**Pas d Alertmanager** : le sujet demande qu une alerte existe et soit evaluee,
pas qu elle notifie.

### Bug 1 — `@willsoto/nestjs-prometheus` rendait le service de depot intestable

Le paquet, prevu pour cela des le bloc 1, est publie en CommonJS et fait un
`require` de `@nestjs/common`, ESM pur depuis NestJS 12 :

```
Must use import to load ES Module: node_modules/@nestjs/common/index.js
  at Object.<anonymous> (node_modules/@willsoto/nestjs-prometheus/src/controller.ts:3:1)
Test Suites: 1 failed, 1 total
```

Toute suite important transitivement `MetricsService` echouait. Dependance
retiree, `prom-client` utilise directement avec un registre dedie : vingt lignes,
et le probleme disparait au lieu d etre masque derriere un transform Babel.

### Bug 2 — le panneau « Erreurs serveur » restait muet quand tout allait bien

```
success  series= 0  Erreurs serveur (5 min)   []
```

`sum(rate(...5xx...))` sur un ensemble vide ne renvoie pas zero, il ne renvoie
**rien**, et la division disparait : le panneau affichait « No data » dans le cas
normal. Corrige par `or vector(0)` — verifie, renvoie `0`.

### Tests executes

```
$ curl -sS -D - http://127.0.0.1:22409/api/metrics | head -8
HTTP/1.1 200 OK
Cache-Control: no-store
Content-Type: text/plain; charset=utf-8; version=0.0.4
Content-Length: 12157

$ curl -sS .../api/metrics | grep "^http_requests_total"
http_requests_total{method="POST",route="/api/public/deposits/:token/verify-pin",status="401"} 6
http_requests_total{method="POST",route="/api/public/deposits/:token/verify-pin",status="200"} 2
http_requests_total{method="POST",route="unmatched",status="404"} 1
http_requests_total{method="POST",route="/api/public/deposits/session/documents/:documentId/confirm",status="200"} 1

$ curl -sS .../api/metrics | grep "^deposit_\|^document_uploads"
deposit_requests_created_total 4
deposit_submissions_total 1
deposit_pin_verifications_total{outcome="invalid"} 6
deposit_pin_verifications_total{outcome="success"} 2
document_uploads_total{outcome="confirmed"} 1
```

Aucun token reel n apparait dans les libelles : la protection de cardinalite
fonctionne.

```
$ promtool check config /cfg/prometheus.yml
 SUCCESS: /cfg/prometheus.yml is valid prometheus config file syntax
$ promtool check rules /cfg/rules/alerts.yml
  SUCCESS: 3 rules found

$ curl -sS .../api/v1/targets
depot-backend    http://host.docker.internal:22409/api/metrics   health=up  lastError=-
prometheus       http://localhost:9090/metrics                   health=up  lastError=-

$ curl -sS -u [REDACTED] .../api/datasources
name=Prometheus type=prometheus uid=prometheus url=http://prometheus:9090 readOnly=True
$ curl -sS -u [REDACTED] .../api/datasources/uid/prometheus/health
OK - Successfully queried the Prometheus API.
$ curl -sS -u [REDACTED] .../api/search?type=dash-db
uid=depot-overview titre='Portail de depot — vue d ensemble' dossier=Portail de depot
```

Les huit requetes du dashboard ont ete executees une par une contre Prometheus :
`status=success` pour les huit.

### L alerte a ete declenchee pour de vrai

```
$ taskkill /PID <backend> /F
$ # apres 20 s
state = pending  | alertes actives : 1
    pending {alertname=BackendIndisponible, severity=critical} activeAt 19:40:34
$ # apres 75 s (for: 1m depasse)
ALERTE FIRING
  BackendIndisponible | state = firing | severity = critical
    Le backend ne repond plus au scrape
$ # backend relance
PLUS AUCUNE ALERTE ACTIVE
```

### Fichiers

```
backend/src/metrics/metrics.constants.ts        noms et types de libelles fermes
backend/src/metrics/metrics.service.ts          registre dedie, 6 metriques
backend/src/metrics/metrics.controller.ts       /api/metrics, exclu d OpenAPI
backend/src/metrics/http-metrics.middleware.ts  res.on('finish'), gabarit de route
backend/src/metrics/metrics.module.ts           @Global
infra/prometheus/prometheus.yml.template        rendu par install.sh
infra/prometheus/rules/alerts.yml               3 regles
infra/grafana/provisioning/{datasources,dashboards}/
infra/grafana/dashboards/depot-overview.json    8 panneaux
```

Le README section 9 decrivait un design *prevu* (noms de metriques inexistants,
journaux JSON correles jamais implementes) : reecrit pour dire le vrai, ecarts
nommes (MinIO non scrape, journaux non structures).

---

## Tour 2 — Bloc 9 : tests

### Prompt

> Maintenant, ajoute et complète les tests Jest du projet.
>
> Objectif : couvrir la logique métier et sécurité réellement importante du
> cahier des charges, sans chercher artificiellement 100 % de coverage et sans
> faire de refactor massif. Priorité aux tests backend.
>
> Couvre au minimum :
>
> 1. Auth avocat : login valide ; mauvais mot de passe ; utilisateur inexistant ;
>    route protégée inaccessible sans authentification.
> 2. Demandes de dépôt : création par un avocat authentifié ; génération correcte
>    du lien/token et PIN ; un avocat ne peut pas accéder à la demande d'un
>    autre ; transitions de statut importantes.
> 3. Accès public / PIN : PIN correct ; PIN incorrect ; compteur de tentatives /
>    lockout ; lien expiré refusé ; token invalide refusé ; lien refusé après
>    soumission ; session client valide uniquement pour la demande concernée.
> 4. Documents : validation des métadonnées ; document inaccessible depuis une
>    autre demande/session ; confirmation d'upload seulement si l'objet existe
>    réellement ; submit impossible sans document AVAILABLE ; submit réussi ;
>    transition PENDING/IN_PROGRESS → SUBMITTED.
> 5. Isolation avocat / client : cookie client ne donne jamais accès aux routes
>    avocat ; session avocat ne remplace pas une session client ; aucune
>    possibilité d'accéder à une ressource d'une autre demande ou d'un autre avocat.
>
> Contraintes : utilise Jest et les outils déjà présents ; privilégie des tests
> déterministes ; ne mocke pas inutilement la logique que le test est censé
> vérifier ; ne modifie pas le comportement fonctionnel juste pour faire passer
> un test ; si un test révèle un vrai bug, corrige le bug puis explique-le ;
> ne casse pas les tests existants.
>
> [...] Ne cherche pas un pourcentage artificiel de coverage. On veut couvrir les
> invariants métier et sécurité importants.

### Reponse (condensee)

Principe directeur : **ne jamais doubler le mecanisme que le test a pour objet
de verifier.**

- **argon2 est reel.** Mocker `argon2.verify` reviendrait a tester qu une
  fonction est appelee, pas qu un mauvais code est refuse.
- **La signature JWT est reelle**, avec deux secrets distincts. Les tokens des
  tests de cloisonnement sont signes et verifies par les gardes de production.
- **Le double de Prisma applique reellement les clauses `where`.** C est le point
  le plus important. Un mock renvoyant `null` quoi qu on lui demande ferait
  passer un test d isolation **meme si le service avait perdu son filtre
  `lawyerId`** — piege dans lequel la validation du bloc precedent etait tombee
  (un 404 obtenu parce que le second avocat n existait pas en base). Le magasin
  contient donc les demandes des DEUX avocats.
- **Le double du stockage retient ce qu on y depose**, avec une taille et un type
  *reels* pouvant differer de ce qui a ete annonce : c est ce qui permet de
  rejouer le cas constate en production (une URL presignee en PUT n impose pas
  les en-tetes).
- **Le vrai `DepositAccessService`** est utilise par les tests de documents,
  puisque c est lui qui porte la regle « cette demande est-elle encore ouverte ? ».

De 9 tests / 1 suite a **136 tests / 8 suites**.

| Suite | Tests |
|---|---|
| `deposit-secrets.spec.ts` | 12 |
| `document-rules.spec.ts` | 18 |
| `auth.service.spec.ts` | 11 |
| `session-isolation.spec.ts` | 17 |
| `deposit.service.spec.ts` | 17 |
| `deposit-access.pin.spec.ts` | 24 |
| `deposit-access.service.spec.ts` (existante, +1) | 9 |
| `documents.service.spec.ts` | 28 |

### Bug trouve par les tests : pollution de prototype dans la liste blanche MIME

`ALLOWED_TYPES[mimeType]` sur un objet litteral consulte aussi la **chaine de
prototypes**. Un type annonce `constructor`, `toString` ou `__proto__` renvoyait
une fonction au lieu de `undefined` : le garde ne declenchait pas, le
`.includes()` suivant levait une `TypeError`.

Test ecrit **avant** le correctif, il echoue comme prevu :

```
● document-rules › refuse proprement un type qui porte le nom d une propriete d Object
  TypeError: allowedExtensions.includes is not a function
Tests: 1 failed, 17 passed, 18 total
```

Confirme de bout en bout contre l API reelle, en retirant puis en remettant le
correctif :

```
AVANT   mimeType=constructor      HTTP 500  {"statusCode":500,"message":"Internal server error"}
        mimeType=toString         HTTP 500
        mimeType=__proto__        HTTP 500
APRES   mimeType=constructor      HTTP 400  {"reason":"MIME_NOT_ALLOWED"}
        mimeType=toString         HTTP 400
        mimeType=__proto__        HTTP 400
```

Le DTO accepte n importe quelle chaine de 3 a 120 caracteres : la valeur est
entierement controlee par le client, donc le 500 etait declenchable a volonte
par tout porteur d une session de depot. Pas de fuite ni de contournement
d authentification, mais un 5xx a la demande fausse la regle d alerte posee au
bloc 8. Corrige par `Object.hasOwn`.

### Les tests d isolation prouvent-ils quelque chose ? Verification par mutation

Filtres `lawyerId` retires du code de production, puis suite relancee :

```
$ # where: { id, lawyerId } -> where: { id }
Tests: 4 failed, 132 passed, 136 total
  ● DocumentsService › REFUSE de lister les pieces de la demande d un confrere
  ● DocumentsService › REFUSE de telecharger la piece d un confrere
  ● DepositService  › REFUSE la demande d un autre avocat, alors qu elle existe bel et bien
  ● DepositService  › repond 404 et non 403, pour ne pas confirmer l existence
$ # filtres restaures
Tests: 136 passed, 136 total
```

### Verifications finales du bloc

```
Test Suites: 8 passed, 8 total
Tests:       136 passed, 136 total
npx tsc --noEmit : 0 erreur
nest build       : OK
dist/ ne contient ni spec, ni helper de test
```

Le README section 8 a ete reecrit : il annoncait des cas de test qui n existaient
pas.

---

## Tour 3 — Bloc 10 : deploiement production

### Prompt

> On passe maintenant uniquement au DÉPLOIEMENT PRODUCTION de l'exercice.
>
> Contexte serveur DIV :
> Sous-domaine : https://amar-idinarene.stage2-div.rayan-drissi.com
> SSH : ssh amar-idinarene@152.228.192.48
> Home : /home/amar-idinarene
> Plage de ports : 22400 à 22499
> Docker : 29.6.2 / Docker Compose : v5.3.1
>
> BIENVENUE.txt indique :
> - HTTP externe : port 80 -> 127.0.0.1:22400
> - HTTPS externe : port 443 -> 127.0.0.1:22401 en TLS passthrough
> - tous mes services doivent écouter sur 127.0.0.1 uniquement
> - mon nginx doit terminer TLS
> - le challenge certbot HTTP-01 est relayé
> - aucun code source sur le serveur
> - uniquement config / compose / env / nginx
> - les images doivent être construites ailleurs, publiées sur GHCR ou Docker Hub,
>   puis pull sur le serveur
>
> Important : les vrais ports d'entrée prod sont 22400 HTTP et 22401 HTTPS.
> Ne réutilise pas les anciens 22480/22443 pour l'entrée prod.
>
> À faire : [1. inspecter l'existant  2. préparer les images  3. publier
> 4. préparer la config serveur sans code source  5. déployer la stack
> 6. configurer nginx  7. Let's Encrypt (staging/dry-run puis réel, renouvellement)
> 8. vérifier les URLs production  9. Prometheus/Grafana en prod
> 10. vérifier que le serveur ne compile rien  11. vérifications finales]
>
> Ne fais pas de refactor métier. Ne casse pas le local. Ne touche à aucun autre candidat.
>
> Travaille de manière autonome sur tout ce que tu peux faire.
> Quand une action nécessite obligatoirement mon intervention, par exemple login
> GHCR, SSH interactif, mot de passe, token GitHub ou commande serveur :
> ARRÊTE-TOI et donne-moi seulement : 1. la commande exacte 2. où l'exécuter :
> LOCAL ou SERVEUR 3. ce que je dois te renvoyer.
> Ne me demande jamais de coller un mot de passe ou token dans la conversation.

### Reponse (condensee)

Rien n existait : ni Dockerfile, ni configuration nginx, ni compose de
production.

**Deux changements de code, minimaux.** `BIND_ADDRESS` (127.0.0.1 par defaut,
`0.0.0.0` en conteneur — sinon nginx ne peut pas joindre le backend, et comme
aucun port n est publie l exposition reste nulle) ; et `prisma` deplace en
`dependencies`, puisque `migrate deploy` tourne depuis l image.

**Image backend** : `node:22-bookworm-slim` et non Alpine, Prisma exigeant
OpenSSL 3.0 — sur musl le Query Engine reste introuvable jusqu au premier appel
a la base. `node_modules` elague dans l etape de build puis copie tel quel, avec
le binaire natif d argon2 deja compile : aucun acces reseau au demarrage. Seed
compile en JavaScript autonome pour eviter `ts-node`. Aucun `ARG`, aucun
`COPY .env`.

**Image frontend** : statiques seuls sur nginx alpine. Le bundle appelle `/api`
en relatif, donc l image est independante du domaine servi.

**Compose de production** : pas un seul `build:`. **Un seul service publie des
ports** — nginx, sur `127.0.0.1:22400` et `127.0.0.1:22401`. PostgreSQL, MinIO,
backend, frontend, Prometheus et Grafana n en publient aucun.

**nginx en deux phases** : un bloc `ssl_certificate` pointant sur un fichier
absent empeche nginx de *demarrer*, or le challenge HTTP-01 exige un nginx en
marche. `install.sh prod` enchaine amorcage HTTP → dry-run certbot → certificat
reel → bascule TLS.

**Paquet serveur** : `infra/make-server-bundle.sh` fabrique l arborescence a
partir d une **liste blanche explicite** puis verifie le resultat (code source,
`backend/`, `frontend/`, `node_modules`, secrets non-placeholder). Une liste
d exclusion aurait oublie le dossier ajoute six semaines plus tard.

### Test de fumee local de la stack de production

Avant de toucher au serveur, toute la stack de production a ete lancee sur la
machine de developpement, avec `curl --resolve depot.local:443:127.0.0.1` :
hostname sans port, donc signatures SigV4 dans les memes conditions qu en
production. **Trois bugs bloquants ont ete trouves la, et non en SSH a l aveugle.**

**Bug 1 — la configuration nginx n etait jamais appliquee.**

```
nginx-1 | ... server: localhost, request: "GET /.well-known/..." host: "depot.local"
nginx-1 | 172.19.0.1 - - "GET / HTTP/1.1" 200 615
curl: (35) schannel: failed to receive handshake, SSL/TLS connection failed
```

`server: localhost`, 615 octets, aucune ecoute sur 443 : nginx servait sa page
par defaut. L entrypoint officiel n execute `envsubst` sur les templates que si
la commande du conteneur commence par `nginx`, or elle avait ete remplacee par
la boucle de rechargement du certificat. Mecanisme de templates abandonne, rendu
par `sed` dans `install.sh`, comme pour `prometheus.yml`.

**Bug 2 — Grafana bouclait en redirection infinie.**

```
$ curl -o /dev/null -D - https://depot.local/grafana/login
HTTP/1.1 301 Moved Permanently
Location: https://depot.local/grafana/login
```

`proxy_pass http://grafana:3000/` avec slash final retirait `/grafana`, que
Grafana reajoutait aussitot via `serve_from_sub_path`. Slash supprime.

**Bug 3 — `docker compose run certbot` aurait fige l installation.** Le service
a pour entrypoint la boucle de renouvellement : sans `--entrypoint certbot`, les
arguments `certonly` etaient ignores et la boucle demarrait a leur place, sans
message. Corrige sur les deux appels.

**Bug 4, hors nginx** — `SEED_LAWYER_NAME=Maitre Amar Idinarene` **non quote**
dans les deux `.env.example`. `install.sh` charge le fichier avec `. ./.env` :

```
.env: line 38: Amar: command not found
```

Sur une installation neuve, le script mourait la. Quotes ajoutees dans les deux
gabarits.

Apres correction, le parcours complet a travers nginx en HTTPS :

```
== 1. Redirection HTTP vers HTTPS ......................... PASS (301)
== 2. Le challenge ACME reste en clair .................... PASS (404, pas 301)
== 3. Frontend, routes profondes /demandes et /d/:token ... PASS (200, 200, 200)
== 4. health/ready {"database":"up","storage":"up"} ....... PASS
== 5. /api/metrics REFUSE depuis l exterieur .............. PASS (403)
== 6. HSTS, nosniff, version de nginx masquee ............. PASS
== 7. Connexion avocat, cookie Secure/HttpOnly/SameSite ... PASS
== 8. Creation d une demande, token 43 car., PIN 6 chiffres PASS
== 9. Mauvais PIN 401, bon PIN 200 ........................ PASS
== 10. PUT navigateur -> nginx -> MinIO ................... PASS (200)
        URL signee : https://depot.local/depot-documents/deposits/[REDACTED]
        taille reelle enregistree (30071 octets) .......... PASS
== 11. Soumission, lien mort ensuite ...................... PASS (200 puis 404)
== 12. Detail avocat SUBMITTED, telechargement 302 -> 200 . PASS
        contenu identique octet pour octet ............... PASS
== 13. Cloisonnement 401 dans les deux sens ............... PASS
== 14. Grafana 200, Prometheus 401 sans identifiants ...... PASS
        cibles : depot-backend=up prometheus=up ........... PASS

  RESULTAT : 50 PASS, 0 FAIL
```

### Publication des images

Deux points ont exige l intervention de l utilisateur, conformement a la
consigne : l identifiant GitHub et l authentification au registre.

> Mon username GitHub est : amaridi
> GHCR login : Login Succeeded

```
$ docker push ghcr.io/amaridi/depot-frontend:1.0.0
1.0.0: digest: sha256:9a8371fe7dc6d348fed0a9bd2654a261c5236cf40f11bab64d875791e7154e61
$ docker push ghcr.io/amaridi/depot-backend:1.0.0
1.0.0: digest: sha256:45e77f94e19536039b77819f171c7f94e607021c14aefddafb405fd25b5089f9

  depot-backend:1.0.0     OK  linux/amd64   852 Mo
  depot-frontend:1.0.0    OK  linux/amd64   75,6 Mo
```

Une optimisation ratee, puis corrigee : supprimer le moteur Prisma pour Windows
dans l etape *runtime* n a rien economise (911 Mo avant, 911 Mo apres) — les
couches Docker sont **additives**, un `rm` dans une couche ulterieure masque le
fichier sans le retirer. Deplace dans l etape de build : 852 Mo.

### Paquet livre au serveur

```
$ bash infra/make-server-bundle.sh
Paquet pret : dist-server.tar.gz (24K)
  dist-server/.env.prod.example
  dist-server/docker-compose.prod.yml
  dist-server/infra/grafana/dashboards/depot-overview.json
  dist-server/infra/grafana/provisioning/...
  dist-server/infra/minio/init.sh
  dist-server/infra/nginx/available/bootstrap.conf.template
  dist-server/infra/nginx/available/production.conf.template
  dist-server/infra/prometheus/prometheus.yml.template
  dist-server/infra/prometheus/rules/alerts.yml
  dist-server/install.sh
  13 fichiers, aucun code source, aucun secret.
```

Le deploiement lui-meme a ete execute par l utilisateur en SSH, `install.sh prod`
enchainant seul l amorcage, le dry-run, le certificat reel, la bascule TLS, les
migrations et le seed.

---

## Tour 4 — Controle final avant rendu

### Prompt

> On fait maintenant le CONTRÔLE FINAL COMPLET avant rendu de l'exercice DIV Protocol.
>
> IMPORTANT : Le projet est fonctionnel. Le déploiement production est réussi.
> URL production : https://amar-idinarene.stage2-div.rayan-drissi.com
> Images publiées sur GHCR. Production : nginx écoute uniquement sur
> 127.0.0.1:22400 HTTP et 127.0.0.1:22401 HTTPS. Let's Encrypt fonctionne et le
> renouvellement automatique est configuré. Les migrations et le seed ont
> fonctionné en production. Les tests étaient à 136/136. Le code final a été push.
>
> OBJECTIF : Vérifier le projet EXACTEMENT par rapport au cahier des charges et
> le rendre prêt à être évalué sur une machine vierge.
>
> NE FAIS PAS : de refactor massif ; de nouvelle architecture ; de feature
> inutile ; d'optimisation esthétique non demandée ; de changement risqué sur la
> production si ce n'est pas nécessaire ; de modification juste pour atteindre
> 100 % de coverage. Corrige uniquement les vrais écarts au sujet.
>
> 1. AUDIT DES EXIGENCES OBLIGATOIRES [...]
> 2. AUDIT SÉCURITÉ [...] Fais un scan du repository pour rechercher les secrets
>    accidentellement commités. IMPORTANT : des mots de passe générés ont été
>    affichés pendant le déploiement. Ils ne doivent apparaître NI dans Git NI
>    dans ai-logs.
> 3. TESTS [...] 4. FRONTEND / UX [...] 5. OBSERVABILITÉ [...] 6. PRODUCTION [...]
> 7. INSTALLATION MACHINE VIERGE — C'est extrêmement important. Audite install.sh
>    comme si l'évaluateur faisait : git clone / cd projet / ./install.sh [...]
> 8. README FINAL [...] 9. AI LOGS [...] 10. GIT FINAL [...]
> 11. TEST FONCTIONNEL FINAL [...] 12. RAPPORT FINAL [...]
>
> Si vérifier un point nécessite mon SSH, NE DEVINE PAS. Donne-moi UNE commande
> exacte, indique "SERVEUR", puis attends mon résultat.

### Scan de secrets — arbre suivi et historique complet

```
A. valeurs de secrets non-placeholder dans les fichiers suivis ... aucune
B. tokens/cles privees/identifiants cloud dans l historique ...... aucun
C. .env, .pem, .key, htpasswd ayant existe en commit ............. aucun
D. chaines ressemblant a un secret genere ........................ aucune
E. secrets dans ai-logs .......................................... aucun
F. tokens de lien de depot reels ................................. aucun
=> aucun secret commite
```

Fichiers interdits : `.env`, `.env.prod`, `dist-server/`, `dist-server.tar.gz`,
`node_modules/`, `*.pem`, `*.key`, `*.tsbuildinfo`, `infra/nginx/secrets/`,
`infra/nginx/active/`, `infra/prometheus/prometheus.yml` — **aucun n est suivi**.

### Installation machine vierge, rejouee pour de vrai

Volumes supprimes, `.env` et fichiers generes effaces, puis `./install.sh local` :

```
[  ok  ] docker operationnel
[install] generation de .env depuis .env.example (secrets aleatoires)
[install] rendu de la configuration Prometheus (cible host.docker.internal:22409)
[  ok  ] conteneurs durables demarres et sains
[  ok  ] bucket et politique d acces en place
[  ok  ] Grafana repond — datasource et dashboard provisionnes
[install] application des migrations
[seed] avocat pret : avocat@div-protocol.test (Maitre Amar Idinarene)
[  ok  ] installation terminee
code de sortie : 0

  secrets generes : 6 valeurs distinctes de 32 caracteres, 0 placeholder restant
  mot de passe du compte de demonstration : [REDACTED]
  mot de passe Grafana : [REDACTED]
```

Aucun avertissement, aucune reparation manuelle. Provisionnement verifie apres
coup : datasource `readOnly`, dashboard 8 panneaux, 3 regles `health=ok` — dont
`BackendIndisponible` en `pending`, le backend n etant pas encore lance, ce qui
demontre au passage que l alerte fonctionne.

Un incident de mon fait : `npm ci` lance alors que le backend tournait encore a
echoue en EPERM et a laisse `node_modules` a moitie supprime. Backend arrete,
`npm ci` rejoue : 599 paquets, exit 0. Verrou de fichier Windows, pas un defaut
du lockfile.

### Production, sondee de l exterieur

```
HTTP -> HTTPS ....... 301 vers https://amar-idinarene.stage2-div.rayan-drissi.com/
ACME en clair ....... 404 (et non 301) : le renouvellement passera
Certificat .......... issuer=Let's Encrypt CN=YE1
                      CN=amar-idinarene.stage2-div.rayan-drissi.com
                      notBefore=Sep  9 20:14:31 2026  notAfter=Dec  8 20:14:30 2026
/ ................... 200      /demandes .............. 200
/d/<token> .......... 200      /api/health/live ....... 200
/api/docs ........... 200      /api/metrics ........... 403
/prometheus/ ........ 401      /grafana/login ......... 200
/api/health/ready ... {"status":"ok","checks":{"database":"up","storage":"up"}}
En-tetes ............ HSTS, nosniff, X-Frame-Options DENY, Referrer-Policy,
                      Server: nginx (sans version)
```

### Ecart trouve : le README decrivait un deploiement qui n a pas eu lieu

Ports 22443/22480 au lieu de 22400/22401, tags `<sha>` au lieu de `1.0.0`, chemin
`infra/nginx/nginx.conf` inexistant, terminaison TLS presentee comme une question
ouverte — et surtout **l URL de production n apparaissait nulle part**. Un
evaluateur n avait aucun moyen de trouver l instance depuis le depot.

Corrige (commit `991f0c9`) : bandeau de production en tete, section 10 reecrite,
schema de routage et table des ports corriges, `infra/nginx/README.md` mis a jour,
lockfile synchronise avec le deplacement de `prisma`.

### Verifications finales

```
Test Suites : 8 passed, 8 total
Tests       : 136 passed, 136 total
backend  tsc --noEmit : 0 erreur      nest build  : OK
frontend tsc --noEmit : 0 erreur      vite build  : 2193 modules, 1,38 s
frontend oxlint       : 0 probleme

Invariant « aucun fichier utilisateur sur le disque applicatif » :
  zero appel writeFile / createWriteStream / fs. / multer dans backend/src
  aucun dossier uploads
  PutObjectCommand sert uniquement a SIGNER une URL
```

### Verdict

**PAS PRET A RENDRE** au moment du rapport, pour un seul motif : l export des
conversations IA des blocs 8 a 10 manquait, alors que le sujet l exige. Tout le
reste etait conforme. Ce fichier comble ce manque.

---

## Etat du projet a la fin de ces trois blocs

**Le produit est deploye, verifie et documente.** Parcours avocat et parcours
client, observabilite avec une alerte declenchee pour de vrai, 136 tests,
images publiees sur GHCR et tirees par le serveur, HTTPS Let's Encrypt avec
renouvellement automatique, et aucun code source sur le serveur.

**Points ouverts, tous documentes dans le README :**

1. **Journal d audit persiste** — ecarte, premier ajout en production.
2. **Pipeline CI** — ecartee : le sujet exige une image publiee et tiree, pas une
   pipeline.
3. **Journaux non structures** — pas d identifiant de correlation par requete.
4. **MinIO non scrape** par Prometheus : `/api/health/ready` distingue deja une
   panne de la base d une panne du stockage.
5. **Lignes `Document` orphelines restees `PENDING`** : non nettoyees.
6. **Rendu navigateur** jamais verifie autrement qu a l oeil sur les contrats
   HTTP.
