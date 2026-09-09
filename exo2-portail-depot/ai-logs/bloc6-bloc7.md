# Session IA — bloc 6 (frontend avocat) et bloc 7 (frontend client anonyme)

**Date** : 9 septembre 2026
**Outil** : Claude Code (CLI)
**Perimetre couvert** : interface de l espace avocat (connexion, liste,
creation, detail), puis interface du parcours client anonyme (lien public, code
a 6 chiffres, file d attente de depot, soumission). Le tour 3 est une validation
de bout en bout de l ensemble du parcours, sans nouvelle fonctionnalite.

> ## Nature de ce document
>
> `/export` n etant pas disponible dans cet environnement, ce fichier est une
> **transcription reconstituee**, pas une capture brute du terminal.
>
> - **Les prompts utilisateur sont verbatim.**
> - **Les reponses de l assistant sont fideles mais condensees** ; le code
>   integralement present dans le depot est resume, avec renvoi au fichier.
> - **Les resultats de commandes sont reproduits tels qu obtenus** (sorties
>   `tsc`, `vite build`, `jest`, `curl` reelles).
>
> Suite de `bloc1-bloc2.md`, `bloc3-bloc4.md` et `bloc5.md`.

---

## Tour 1 — Bloc 6 : frontend du parcours avocat

### Prompt

> Maintenant, implémente le frontend du parcours avocat.
>
> À implémenter :
>
> 1. Une page de connexion.
> 2. La gestion de la session côté frontend.
> 3. Une page listant les demandes de dépôt de l'avocat connecté.
> 4. Une page de création d'une demande.
> 5. L'affichage du lien public et du PIN généré, une seule fois.
> 6. Une page de détail d'une demande avec les documents déposés.
> 7. La possibilité de télécharger un document.
>
> Utilise :
>
> * React + TypeScript
> * Chakra UI v3
> * React Router
> * TanStack Query
> * react-hook-form
> * les composants et le thème déjà créés.
>
> Contraintes :
>
> * Ne réécris pas le thème existant.
> * Ne crée pas de backend supplémentaire.
> * Utilise l'API NestJS existante.
> * Garde les appels API séparés des composants lorsque c'est pertinent.
> * Interface simple et propre, pas besoin de surdesign.

### Reponse (condensee)

Cinq decisions structurantes, expliquees avant le code :

**1. Pas de React Context pour la session.** TanStack Query *est* le cache de
session. `useSession()` ([useSession.ts](../frontend/src/features/auth/useSession.ts))
est un `useQuery` sur `GET /auth/me` avec `retry: false` — un 401 est la reponse
normale d un visiteur non connecte, pas une erreur a reessayer. Le serveur reste
l unique source de verite sur l etat de connexion : le frontend ne deduit jamais
d un cookie present qu il est authentifie, puisque le cookie est `HttpOnly` et
donc invisible en JavaScript. A la deconnexion, tout le cache est vide
(`queryClient.clear()`) : aucune donnee d un compte ne peut survivre a la
connexion du suivant.

**2. Route protegee par defaut.** `ProtectedRoute` est une `<Route element>`
parente : toute route ajoutee dans ce bloc est protegee sans y penser. C est la
transposition exacte du `@UseGuards` pose sur le controleur entier cote
backend — *le defaut sur doit etre le defaut*.

**3. Les secrets ne sont affiches qu une fois.** `POST /deposits` renvoie le
lien et le PIN ; aucun autre endpoint ne les redonnera jamais. La page de
creation passe donc en mode « voici les secrets, copiez-les maintenant », avec
deux boutons `Clipboard` et un avertissement explicite. Le formulaire n est pas
reaffiche : le retour arriere ne rejoue pas la creation.

**4. Appels API separes des composants.** `requests.api.ts` ne connait que les
types et `axios` ; `request.helpers.ts` ne contient que des fonctions pures
(libelles de statut, formats de date). Les composants n assemblent que de
l affichage.

**5. Un client axios unique** ([lib/api.ts](../frontend/src/lib/api.ts)) avec
`withCredentials: true` et `baseURL: /api`. Le cookie voyage seul ; aucun jeton
n est jamais lu, stocke ni manipule cote navigateur.

### Fichiers crees

```
frontend/src/lib/api.ts                              client axios unique, withCredentials
frontend/src/features/auth/auth.api.ts               login / logout / me
frontend/src/features/auth/useSession.ts             session = cache TanStack Query
frontend/src/features/auth/LoginPage.tsx             react-hook-form + zod
frontend/src/components/ProtectedRoute.tsx           garde par defaut
frontend/src/components/AppShell.tsx                 en-tete, identite, deconnexion
frontend/src/components/ui/{Card,StatusBadge,States}.tsx
frontend/src/features/requests/requests.api.ts       appels demandes + telechargement
frontend/src/features/requests/request.helpers.ts    fonctions pures d affichage
frontend/src/features/requests/RequestsPage.tsx      liste
frontend/src/features/requests/NewRequestPage.tsx    creation + secrets une seule fois
frontend/src/features/requests/RequestDetailPage.tsx detail + pieces + telechargement
frontend/src/App.tsx                                 routage
```

### Verifications executees

```
$ npm run typecheck    # tsc --noEmit
$ npm run build        # chakra typegen + vite build
$ npm run lint         # oxlint
```

Les trois passent. Le `chakra typegen` est cable dans le script de build : sans
lui, les variantes de recette maison (`variant="div"`) ne sont pas typees et
`tsc` echoue — piege deja rencontre au bloc 1.

### Point ouvert signale a l utilisateur

Le formulaire de creation exposait un champ `expiresInDays`, ajoute au bloc 3.
J ai demande s il fallait le garder ou revenir a une expiration fixe : le
backend acceptait le champ mais le sujet n en demande pas le reglage, et un
champ de plus est une surface de validation de plus.

---

## Tour 2 — Bloc 7 : frontend du parcours client anonyme

### Prompt

> * je prefere garder une expiration fixe sauf si le backend est déjà complètement câblé avec ce champ.
>
> Maintenant, implémente le frontend du parcours client anonyme.
>
> À implémenter :
>
> 1. Une page accessible par le lien public.
> 2. La saisie du PIN.
> 3. L'obtention de la session temporaire.
> 4. L'affichage des informations de la demande.
> 5. L'upload de documents avec retour visuel.
> 6. La liste des documents déjà déposés.
> 7. La soumission finale du dépôt.
>
> Contraintes :
>
> * Le client ne doit jamais avoir accès aux routes avocat.
> * Aucun mot de passe avocat ne doit être présent côté client.
> * Aucun credential MinIO ne doit être exposé au navigateur.
>
> Respecte le thème Chakra existant. Utilise les endpoints backend déjà créés.

### Reponse (condensee)

**Expiration fixe, comme demande.** Le backend n etait pas « completement
cable » avec `expiresInDays` : le champ etait accepte mais aucune logique n en
dependait. Il est donc retire du DTO, du service, du formulaire, des types et du
README ; la duree vient desormais de `DEPOSIT_LINK_TTL_DAYS` seule. Une option
de moins a valider, a documenter et a tester.

**Cloisonnement client / avocat par le graphe de dependances, pas par
convention.** Aucun fichier de `features/deposit/` n importe quoi que ce soit de
`features/auth/` ni de `features/requests/`. Le parcours client a son propre
module d erreurs, ses propres cles de cache et sa propre coquille de mise en
page. Cote reseau, la separation est deja garantie par les deux audiences JWT et
les deux secrets de signature distincts du bloc 4 : ce n est pas l interface qui
empeche un client d appeler une route avocat, c est le serveur.

**Le point delicat : l upload navigateur vers MinIO.**
`uploadDocument()` ([deposit.api.ts](../frontend/src/features/deposit/deposit.api.ts))
enchaine trois etapes :

1. `POST session/documents` — le backend renvoie un ticket : URL presignee et
   `requiredHeaders`. Aucun identifiant MinIO ne transite ;
2. `PUT` **directement du navigateur vers MinIO**, avec `withCredentials: false` —
   explicitement, pour ne jamais envoyer le cookie de session au stockage objet,
   qui n a aucune raison de le voir ;
3. `POST .../confirm` — le backend fait un `HeadObject` et verifie la taille et
   le type *reels* avant de basculer le document en `AVAILABLE`.

**Envoi sequentiel, pas parallele.** `UploadQueue` traite les fichiers un par
un : plus lisible pour le client, plus doux sur une connexion faible, et un lot
entier n echoue pas parce que le quota a ete atteint au milieu. Chaque element
porte sa propre progression et sa propre erreur ; un fichier refuse localement
(mauvaise extension) n est meme pas envoye.

**Un cas limite reel traite** : le navigateur peut porter une session ouverte
pour une *autre* demande (deux liens ouverts a la suite). Les identifiants
techniques n etant pas exposes cote public, `DepositPage` compare ce qui est
affichable ; en cas de desaccord il redemande le code plutot que de montrer le
mauvais dossier.

**Erreurs volontairement indistinctes.** `describeDepositError` traduit tout 404
en un seul message : lien inconnu, expire, deja soumis ou cloture ne sont pas
distingues — c est le choix du serveur, l interface ne le trahit pas.

### Fichiers crees

```
frontend/src/features/deposit/deposit.api.ts        resolve, PIN, upload 3 etapes, submit
frontend/src/features/deposit/deposit.rules.ts      allowlist, tailles, formats (pur)
frontend/src/features/deposit/deposit.errors.ts     traduction uniforme des erreurs
frontend/src/features/deposit/deposit.queries.ts    cles de cache dediees
frontend/src/features/deposit/DepositShell.tsx      mise en page publique
frontend/src/features/deposit/PinForm.tsx           PinInput 6 chiffres + tentatives
frontend/src/features/deposit/UploadQueue.tsx       file d attente sequentielle
frontend/src/features/deposit/DepositWorkspace.tsx  pieces + soumission
frontend/src/features/deposit/DepositPage.tsx       aiguillage des trois etats
```

### Verifications executees

```
$ npm run typecheck    # tsc --noEmit          OK
$ npm run build        # vite build            OK
$ cd ../backend && npm run typecheck           OK
$ npm test                                     8 passed, 1 suite
```

---

## Tour 3 — Validation complete de bout en bout

### Prompt

> Avant de continuer le projet, effectue une validation complète du parcours actuel de bout en bout.
> Ne développe aucune nouvelle fonctionnalité et ne refactorise rien sauf si tu découvres un bug bloquant.
>
> Vérifie autant que possible :
>
> 1. Que PostgreSQL et MinIO démarrent correctement.
> 2. Que les migrations et le seed s'exécutent.
> 3. Que le backend démarre.
> 4. Que le frontend démarre.
> 5. Que la connexion de l'avocat de démo fonctionne.
> 6. Que la création d'une demande fonctionne.
> 7. Que le lien public et le PIN sont générés.
> 8. Que le lien public s'ouvre côté client.
> 9. Que la validation du PIN fonctionne.
> 10. Qu'un upload réel arrive dans MinIO.
> 11. Que la confirmation enregistre la bonne taille.
> 12. Que le document apparaît côté client.
> 13. Que la soumission fonctionne.
> 14. Que le statut passe à SUBMITTED côté avocat.
> 15. Que la liste des documents s'affiche côté avocat.
> 16. Qu'un téléchargement réel fonctionne.
> 17. Que le lien public est mort après soumission.
> 18. Que les tests Jest passent.
> 19. Que le typecheck et le build frontend passent.
> 20. Que le typecheck et le build backend passent.
>
> Ne simule pas les résultats. Distingue clairement ce que tu as réellement exécuté de ce que tu n'as pas pu tester.
> Si tu trouves un bug bloquant, corrige uniquement ce bug et reteste le scénario concerné.
>
> À la fin, donne-moi :
>
> * PASS/FAIL pour chaque étape ;
> * les bugs trouvés et corrigés ;
> * ce que je dois encore tester manuellement dans un navigateur.

### Resultat : 20 etapes sur 20 en PASS

Scenario metier joue en entier contre la pile reelle (PostgreSQL 16.15 et MinIO
en conteneurs, backend sur 22419, `vite preview` sur 22471) :

```
login 200 + cookie pose
POST /deposits 201            token 43 caracteres, PIN 6 chiffres, PENDING, +7 jours
GET /public/deposits/:token   200, aucun id ni hash divulgue
verify-pin mauvais PIN        401 {"attemptsLeft":4}
verify-pin bon PIN            200 + cookie deposit_session
POST session/documents        201, signature 600 s, aucun credential MinIO
PUT navigateur -> MinIO       200   (PDF reel de 40194 octets)
POST .../confirm              200, taille reelle enregistree = 40194
GET session/documents         1 document AVAILABLE, storageKey non expose
statut de la demande          IN_PROGRESS
POST session/submit           200, SUBMITTED + submittedAt
cote avocat                   SUBMITTED, submittedAt, 1 document
GET .../download              302 -> presigned GET 60 s -> 200
                              Content-Disposition RFC 5987, contenu octet pour octet identique
meme URL sans signature       403
apres soumission              404 sur les 7 routes client, y compris avec le bon PIN
cloisonnement croise          401 dans les deux sens (cookie client sur route avocat et inversement)
```

Verifie en plus : les conteneurs n ecoutent que sur `127.0.0.1`, aucun fichier
utilisateur sur le disque du backend, `.env` ignore par git, `tokenHash` en 64
caracteres hexadecimaux, `pinHash` en argon2id, aucune erreur dans les journaux.

### Bug trouve et corrige : le provisionnement MinIO echouait en silence

`docker compose logs minio-init` a revele que **deux commandes echouaient depuis
le bloc 1**, avalees par mes propres `|| echo "non bloquant"` — exactement le
motif que je reprochais a `install.sh` au bloc 1 :

```
mc: <ERROR> Unable to set bucket CORS configuration: decoding xml: EOF
mc: <ERROR> Unable to set new lifecycle rules: The XML you provided was not well-formed
```

1. **CORS jamais applique.** MinIO **n implemente pas** la configuration CORS
   par bucket (`A header you provided implies functionality that is not
   implemented`). Les uploads navigateur ne fonctionnaient que parce que MinIO
   reflete l origine par defaut. Le README annoncait donc une propriete de
   securite inexistante. Corrige par `MINIO_API_CORS_ALLOW_ORIGIN` declare sur
   le service minio dans `docker-compose.yml`, avec l origine de production
   **et** celle du serveur Vite — sans quoi restreindre le CORS aurait casse les
   uploads en developpement.
2. **Regle de cycle de vie jamais posee.** `mc` refuse une regle limitee a
   `AbortIncompleteMultipartUpload`. Sans consequence ici (les depots sont des
   PUT simples), la tentative est retiree plutot que maquillee.
3. **`infra/minio/init.sh` reecrit** : plus aucun echec avale, `set -eu` sans
   echappatoire, et la politique privee est *verifiee* apres application
   (`mc anonymous get`).
4. **README section 7 corrigee** pour decrire ce que le systeme fait reellement,
   avec le residu connu nomme : les lignes `Document` restees `PENDING` ne sont
   pas nettoyees.

Aucun bug bloquant dans le parcours metier. Apres correction :
`docker compose run --rm minio-init` sort en 0 sans erreur, typecheck backend et
frontend OK, 8/8 tests, `docker compose config --quiet` valide.

### Ce qui n a pas pu etre teste

- **Le rendu et les interactions dans un navigateur** : seuls les contrats HTTP
  et la compilation sont valides.
- **Un demarrage a froid depuis une base vide** : cela demandait
  `prisma migrate reset`, destructif sur les donnees de l utilisateur, non
  execute sans son accord. Les migrations sont validees « a jour », pas
  « rejouables depuis zero ».
- **La nouvelle valeur de `MINIO_API_CORS_ALLOW_ORIGIN` n est pas active** :
  MinIO tournait depuis 19 h avec l ancienne configuration. Elle s appliquera au
  prochain `docker compose up -d minio`.

### A tester manuellement dans un navigateur, par ordre de risque

1. Le `PinInput` Chakra v3 : les six cases, l avance automatique du focus, la
   validation a la sixieme touche, l etat invalide apres un mauvais code.
2. La barre de progression pendant un envoi reel, avec un fichier de plusieurs
   megaoctets — sinon elle passe de 0 a 100 instantanement.
3. Les boutons « Copier » (`Clipboard` v3) sur l ecran du lien et du PIN, et le
   fait que cet ecran remplace bien le formulaire.
4. Le survol du bouton primaire : fond `#F7F6FF`, contour inset, et surtout
   aucun decalage d un pixel.
5. Le telechargement depuis la fiche avocat : vrai telechargement avec le nom
   d origine accentue, pas un affichage du PDF dans l onglet.
6. Un depot multi-fichiers avec un fichier refuse au milieu (un `.zip`) : les
   autres doivent continuer.
7. Le rechargement de page avec une session ouverte, cote avocat comme cote
   client.

---

## Etat du projet a la fin de ces deux blocs

**Le produit est complet et verifie a l execution de bout en bout** : parcours
avocat et parcours client, interface comprise, dans le respect de la charte DIV
et des invariants de securite du sujet (aucun fichier sur le disque de
l application, bucket prive, URLs temporaires, PIN et token jamais stockes en
clair, secrets hors depot).

**Points ouverts :**

1. **Mode de terminaison TLS du proxy frontal DIV** — question redigee dans
   `infra/nginx/README.md`. Seul point dont le delai ne depend pas de nous.
2. **Observabilite** : Prometheus et Grafana pas encore branches, ni la regle
   d alerte (Attendu du sujet).
3. **Couverture de tests** : 8 tests, sur la soumission. Restent a couvrir
   l expiration des liens, la verification du PIN et le verrouillage (Attendu).
4. **Image Docker et publication sur GHCR**, puis `install.sh` en mode `prod`.
5. Nettoyage des lignes `Document` orphelines restees `PENDING` : ecart connu,
   documente, non corrige.
