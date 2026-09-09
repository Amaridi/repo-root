# Session IA — bloc 3 (demandes de depot) et bloc 4 (acces client anonyme)

**Date** : 9 septembre 2026
**Outil** : Claude Code (CLI)
**Perimetre couvert** : `DepositModule` (espace avocat) et `DepositAccessModule`
(parcours client anonyme, token public + PIN + session).

> ## Nature de ce document
>
> `/export` n'etant pas disponible dans cet environnement, ce fichier est une
> **transcription reconstituee**, pas une capture brute du terminal.
>
> - **Les prompts utilisateur sont verbatim.**
> - **Les reponses de l'assistant sont fideles mais condensees** ; le code
>   integralement present dans le depot est resume, avec renvoi au fichier.
> - **Les resultats de tests sont reproduits tels qu'obtenus** (sorties `curl`
>   reelles contre PostgreSQL).
>
> Suite de `bloc1-bloc2.md`.

---

## Tour 1 — Bloc 3 : creation et consultation des demandes

### Prompt

> Maintenant, implémente la fonctionnalité permettant à un avocat authentifié de
> créer et consulter des demandes de dépôt de pièces.
>
> Objectif :
> Un avocat connecté doit pouvoir :
>
> * créer une nouvelle demande de dépôt ;
> * fournir les informations nécessaires du client ;
> * obtenir une demande avec un identifiant unique ;
> * consulter ses demandes ;
> * consulter le détail d'une demande.
>
> À implémenter :
>
> 1. Un `DepositModule`.
> 2. Un `DepositController`.
> 3. Un `DepositService`.
> 4. Les DTO nécessaires avec validation.
> 5. Les opérations Prisma nécessaires avec le modèle `DepositRequest`.
> 6. La protection des routes avec le Guard d'authentification avocat.
> 7. Les vérifications permettant qu'un avocat ne puisse accéder qu'à ses propres demandes.
> 8. Les statuts nécessaires pour suivre l'état d'une demande.
>
> Contraintes :
>
> * Le controller ne doit contenir que la logique HTTP.
> * La logique métier doit être dans le service.
> * Utilise Prisma pour PostgreSQL.
> * Respecte le schema Prisma existant.
> * Ne fais pas encore l'upload de fichiers.
> * Ne fais pas encore le parcours client anonyme.
> * Ne modifie pas le système d'authentification sauf si strictement nécessaire.
>
> À la fin :
>
> * Vérifie que le backend compile.
> * Teste au minimum les endpoints avec des données réalistes.
> * Résume en maximum 5 points.
> * Liste les fichiers créés/modifiés et leur rôle.

*(Le prompt avait d'abord ete envoye dans une forme plus courte mentionnant
explicitement le token aleatoire et le PIN a 6 chiffres genere cote serveur,
puis complete par la version ci-dessus. Les deux ont ete traites ensemble.)*

### Reponse (condensee)

**Ecart de nommage assume et signale d'emblee** : le README parlait de
`DepositRequestsModule`, le prompt impose `DepositModule`. Le nommage du prompt
a ete retenu et **le README corrige**, pour que code et documentation ne
divergent pas.

**Cinq points retenus :**

1. **Les deux secrets sont generes cote serveur, jamais choisis par l'avocat** :
   token de 32 octets (256 bits, base64url) et PIN a 6 chiffres via
   `crypto.randomInt` — source cryptographiquement sure et distribution uniforme,
   sans biais modulo. Un secret saisi par un humain serait devinable et
   transiterait dans le corps de la requete, donc dans les journaux.

2. **Seules les empreintes sont persistees** : `tokenHash` en SHA-256 (le token
   porte 256 bits, il n'est pas brute-forcable, et doit rester consultable en
   O(1) a chaque requete publique) et `pinHash` en argon2id (10^6 combinaisons,
   hachage lent obligatoire). Le lien complet et le PIN en clair n'apparaissent
   **que dans la reponse de creation**, une seule fois.

3. **L'isolation entre avocats est dans le `WHERE`, pas dans un controle a
   posteriori** : `findFirst({ where: { id, lawyerId } })`. Il n'existe aucun
   chemin de code capable de lire la demande d'un autre avocat. La reponse est
   **404 et non 403**, pour ne pas confirmer l'existence de la demande.

4. **Aucune entite Prisma n'est serialisee directement** : un mapper explicite
   (`toDepositRequestView`) construit la reponse champ par champ. C'est ce qui
   garantit que `tokenHash` et `pinHash` ne peuvent pas fuiter par l'ajout
   distrait d'un champ au schema.

5. **`isExpired` est calcule, jamais stocke**, conformement a la decision de
   modelisation du bloc 1. Le statut persiste (`PENDING` par defaut) ne
   represente que des actes metier.

**Choix de conception secondaires :** garde posee sur le controleur entier et non
route par route (le defaut devient « protege ») ; `ParseUUIDPipe` sur `:id` pour
qu'un identifiant malforme n'atteigne jamais la base ; fonctions de generation
des secrets isolees dans un fichier **pur** (`deposit-secrets.ts`), sans
dependance a Nest ni Prisma, donc directement testables au bloc 8 et
reutilisables par le parcours client au bloc 4.

**Ajout signale comme discutable** : `expiresInDays` optionnel (1 a 90 jours,
defaut `DEPOSIT_LINK_TTL_DAYS`), presente comme le complement naturel d'un lien
expirable, avec proposition de le retirer s'il est juge hors perimetre.

### Tests executes (API reelle, PostgreSQL)

| # | Cas | Resultat |
|---|---|---|
| 1 | Creation avec donnees realistes | 201 — email normalise (` Jeanne.Martin@Example.com ` -> `jeanne.martin@example.com`), PIN `025464` (zero de tete conserve) |
| 2 | Liste de ses demandes | 2 demandes, tri decroissant, `documentsCount` present, **aucun `tokenHash`/`pinHash`** |
| 3 | Detail | 200 |
| 4 | UUID inexistant | 404 |
| 5 | Identifiant malforme | 400, bloque avant la base |
| 6 | Sans authentification | 401 |
| 7-8 | **Second avocat cree**, tente d'ouvrir la demande du premier | liste vide, **404** sur le detail |
| 9 | Validation | 400 — titre trop court, nom trop court, email invalide, `expiresInDays: 365` > 90, champ `status` injecte rejete par `forbidNonWhitelisted` |
| 10 | 5 creations successives | 5 PIN et 5 tokens tous distincts |

Verification en base : `tokenHash` = 64 caracteres hexadecimaux (SHA-256),
`pinHash` en `$argon2id$v=19$m=65536,p=4,t=3`, aucun PIN en clair.

### Fichiers

**Crees** — `backend/src/deposit/` : `deposit.module.ts`,
`deposit.controller.ts`, `deposit.service.ts`, `deposit-secrets.ts`,
`dto/create-deposit-request.dto.ts`, `dto/deposit-request.view.ts`.

**Modifies** — `src/app.module.ts`, `README.md` (renommage
`DepositRequestsModule` -> `DepositModule`).

### Verifications

`tsc --noEmit` : OK. `nest build` : OK.

**Effet de bord signale** : les tests ont laisse 7 demandes et un second avocat
(`confrere@div-protocol.test`) dans la base de developpement.

---

## Tour 2 — Bloc 4 : acces client anonyme

### Prompt

> Maintenant, implémente le mécanisme d'accès client anonyme aux demandes de dépôt.
>
> Objectif :
> L'avocat doit pouvoir partager une demande avec son client sans que le client ait de compte.
>
> Pour chaque demande :
>
> * générer un token public cryptographiquement aléatoire et imprévisible ;
> * générer un PIN ;
> * stocker uniquement le hash du PIN en base ;
> * définir une date d'expiration ;
> * permettre au client d'utiliser le lien public + PIN pour accéder à sa demande ;
> * refuser l'accès si le lien est expiré.
>
> À implémenter :
>
> 1. La génération sécurisée du token public.
> 2. La génération du PIN.
> 3. Le hash du PIN avec Argon2.
> 4. La vérification du PIN.
> 5. Les endpoints publics nécessaires.
> 6. La vérification systématique de l'expiration.
> 7. Un mécanisme de session/token temporaire après validation correcte du PIN afin
>    que le PIN ne soit pas renvoyé à chaque requête.
>
> Sécurité :
>
> * Ne jamais stocker le PIN en clair.
> * Ne jamais utiliser un identifiant séquentiel comme token public.
> * Ne jamais permettre l'accès à une demande simplement avec son ID Prisma.
> * Ne jamais permettre l'accès après expiration.
> * Les erreurs ne doivent pas révéler inutilement si une demande existe.
>
> Ne fais pas encore l'upload de fichiers ni le dashboard frontend.
>
> À la fin :
>
> * Vérifie que le backend compile.
> * Explique en maximum 5 points le fonctionnement du parcours client.
> * Liste les fichiers créés/modifiés.
>
> Réutilise le mécanisme d'audience JWT déjà en place (aud: 'lawyer' pour l'avocat)
> en créant une audience distincte pour ce token de session de dépôt (par exemple
> aud: 'deposit'), pour garantir qu'un token client ne puisse jamais être utilisé
> comme un token avocat, et inversement.

### Reponse (condensee)

**Signale d'emblee** : les points 1 a 3 sont deja livres au bloc 3 dans
`deposit-secrets.ts` et sont **reutilises tels quels**, sans aucun code nouveau.
C'est precisement pourquoi ces fonctions avaient ete extraites en fonctions
pures : generation et verification ne peuvent pas diverger.

**Le parcours en 5 points :**

1. **Le token du lien est le seul designateur accepte.** Aucune route publique
   ne prend d'identifiant de demande ; `GET /public/deposits/:token` cherche par
   `tokenHash`. L'ID Prisma n'ouvre donc aucun acces meme s'il etait connu —
   verifie, il renvoie 404. Le format est filtre par une regex en amont, une
   entree arbitraire n'atteint jamais la base.

2. **Toutes les impasses repondent a l'identique** : token inconnu, malforme,
   expire, deja soumis ou cloture donnent **404, meme message, dans les cinq
   cas**. Un scanner n'apprend jamais qu'un token existe.

3. **Le PIN n'est saisi qu'une fois.** Apres verification argon2, un JWT de
   30 min est pose en cookie `HttpOnly` : le navigateur n'a jamais a conserver le
   PIN pour les requetes suivantes, et le JavaScript de la page ne peut pas lire
   la session.

4. **Le compteur de tentatives est porte par la demande, pas par l'IP** —
   changer d'adresse ne le remet pas a zero — et il est **persiste en base**,
   donc un redemarrage de l'API ne l'efface pas. 5 echecs -> verrou 15 min, et
   pendant le verrou **meme le bon PIN est refuse**. Un succes remet le compteur
   a zero.

5. **L'expiration est reverifiee a chaque requete, pas seulement a
   l'ouverture.** Une session emise avant l'echeance ne survit pas au lien :
   avec un cookie encore cryptographiquement valide, `session/me` passe a 404 des
   que la demande expire ou est soumise. Le JWT seul ne suffit jamais.

**Cloisonnement des deux univers de jetons.** `DepositAccessModule`
**n'importe pas `AuthModule`** : il enregistre sa propre instance de `JwtModule`
avec `JWT_DEPOSIT_SECRET` et `aud: 'deposit'`. La separation n'est donc pas une
convention mais une propriete du graphe de dependances — aucun code de ce module
ne dispose de la cle avocat, et reciproquement. L'audience est la seconde
barriere, redondante a dessein : elle protege le jour ou une erreur de
configuration ferait pointer les deux secrets sur la meme valeur.

**Point d'extension prepare pour le bloc 6** : `assertOpenForDeposit(requestId)`
est exporte comme point d'entree unique du controle d'etat — aucune ecriture
(upload, confirmation) ne devra le contourner.

### Tests executes (API reelle, PostgreSQL)

| # | Cas | Resultat |
|---|---|---|
| 1 | Resolution du lien | 200 — titre, consignes, nom de l'avocat, echeance |
| 2 | Fuite d'identifiant | aucun `id` ni UUID dans la reponse publique |
| 3 | Token inconnu / malforme / **ID Prisma** | 404 identique pour les trois |
| 4 | Mauvais PIN x3 | 401 avec `attemptsLeft` 4, 3, 2 |
| 5 | Bon PIN | 200, cookie `deposit_session` HttpOnly/SameSite=Strict, compteur remis a zero |
| 6-7 | `session/me` avec / sans cookie | 200 / 401 |
| 8 | **Cookie avocat** sur la route client | 401 |
| 9 | **Cookie client** sur `/deposits` et `/auth/me` | 401 dans les deux cas |
| 10 | 5 mauvaises tentatives | 401 x5 puis **403** `retryAfterSeconds: 900` |
| 11 | Bon PIN **pendant le verrou** | 403 — le verrou prime |
| 12 | PIN mal forme (`12ab`) | 400 |
| 13 | **Lien expire** | 404 sur `resolve`, `verify-pin` **et** `session/me` malgre un cookie valide |
| 14 | **Demande deja soumise** | 404 — rejeu du lien impossible |

### Fichiers

**Crees** — `backend/src/deposit-access/` : `deposit-access.module.ts`,
`deposit-access.controller.ts`, `deposit-access.service.ts`,
`guards/deposit-session.guard.ts`, `decorators/current-deposit.decorator.ts`,
`dto/verify-pin.dto.ts`, `dto/public-deposit.view.ts`,
`deposit-access.constants.ts`, `deposit-access.types.ts`.

**Modifie** — `src/app.module.ts`.

### Verifications

`tsc --noEmit` : OK. `nest build` : OK.

**Compromis signale** : le token seul, avant le PIN, revele le nom de l'avocat et
l'objet de la demande. Choix delibere — sans cela le client saisit un code sans
savoir de quoi il s'agit — commente dans le code, et reversible en une ligne dans
`resolve`.

---

## Endpoints disponibles a la fin de ces deux blocs

```
Espace avocat (cookie depot_session, aud: lawyer)
  POST   /api/auth/login
  POST   /api/auth/logout
  GET    /api/auth/me
  POST   /api/deposits                      creation + lien et PIN, une seule fois
  GET    /api/deposits                      ses propres demandes
  GET    /api/deposits/:id                  detail, 404 si autre proprietaire

Parcours client (cookie deposit_session, aud: deposit)
  GET    /api/public/deposits/:token             metadonnees, avant PIN
  POST   /api/public/deposits/:token/verify-pin  ouvre la session
  GET    /api/public/deposits/session/me         etat de la demande
  POST   /api/public/deposits/session/logout     ferme la session

Exploitation
  GET    /api/health/live
  GET    /api/health/ready
  GET    /api/docs                               OpenAPI
```

## Etat du projet

**Termine** : blocs 1 a 4. Le socle, l'authentification avocat, la gestion des
demandes et le parcours client anonyme sont fonctionnels et verifies a
l'execution.

**Points ouverts :**

1. **Mode de terminaison TLS du proxy frontal DIV** — question redigee dans
   `infra/nginx/README.md`, reponse requise avant le bloc 5.
2. **Base de developpement polluee** par les donnees de test (plusieurs demandes,
   un second avocat) : `npm run prisma:reset` pour repartir propre.
3. **`expiresInDays`** : ajout du bloc 3 en attente de validation.

**Suite** : bloc 5 (spike deploiement : Dockerfiles, GHCR, nginx, HTTPS) puis
bloc 6 (stockage MinIO et upload presigne).
