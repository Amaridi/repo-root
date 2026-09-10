# nginx — routage applicatif

Ce nginx n'est **pas** le proxy d'entree public : le serveur d'exercice dispose
deja d'un proxy frontal mutualise. Mais celui-ci fait du **passthrough SNI**,
donc c'est bien ce nginx qui **termine TLS**, en plus de reunir les cinq
surfaces de l'application derriere un hostname unique.

```
127.0.0.1:22401 (HTTPS, TLS termine ici)   <- port 443 externe, passthrough SNI
127.0.0.1:22400 (HTTP)                     <- port 80 externe, ACME + redirection

  /                    -> frontend:80  (SPA, repli index.html)
  /api/                -> backend:22409
  /api/metrics         -> REFUSE depuis l'exterieur (voir regle 3)
  /depot-documents/    -> minio:9000        (sans reecriture de chemin)
  /grafana/            -> grafana:3000      (serve_from_sub_path)
  /prometheus/         -> prometheus:9090   (web.external-url deja pose)
```

## Trois regles a ne pas casser

**1. Aucune reecriture sur `/depot-documents/`.** Les presigned URLs sont des
signatures SigV4 qui couvrent le chemin et l'en-tete `Host`. Le prefixe est le
nom du bucket, ce qui rend l'URL valide telle quelle cote MinIO. Un
`rewrite` ou un `proxy_pass` avec URI de destination casserait toutes les
signatures avec une erreur `SignatureDoesNotMatch` difficile a diagnostiquer.
Il faut donc `proxy_pass http://minio:9000;` sans slash final, et
`proxy_set_header Host $host;`.

**2. `client_max_body_size` genereux sur `/depot-documents/`** (au moins la
taille maximale d'un depot). Les octets traversent nginx, jamais le backend.

**3. `/api/metrics` doit etre refuse depuis l'exterieur.** L'exposition des
metriques n'est pas authentifiee cote application, deliberement : Prometheus
scrape en HTTP simple sur le reseau interne et le backend n'ecoute que sur
`127.0.0.1`. C'est donc **ici** que se joue le cloisonnement. Le bloc doit
preceder `/api/` — nginx retient le prefixe le plus long, mais l'ordre reste
lisible :

```nginx
location = /api/metrics {
    deny all;   # scrape uniquement depuis le reseau interne du compose
}
```

Sans cette regle, n'importe qui pourrait lire les volumes de depot, les
verrouillages et les gabarits de routes. Les tokens eux-memes ne fuient pas
(les labels sont des gabarits, jamais des URLs), mais l'activite du cabinet est
une information confidentielle en soi.

`/prometheus/` et `/grafana/` doivent egalement etre proteges : Grafana a sa
propre authentification (compte admin, acces anonyme desactive), Prometheus
**n'en a aucune**. A minima une restriction par IP ou un `auth_basic` sur
`/prometheus/`.

## Terminaison TLS : tranche et deploye

Le proxy frontal de la plateforme fait du **passthrough SNI** sur le port 443
externe vers `127.0.0.1:22401`. Le trafic chiffre arrive donc intact jusqu'ici,
et **c'est ce nginx qui termine TLS et presente le certificat**. Le port 80
externe est relaye vers `127.0.0.1:22400`, ce qui rend le challenge ACME HTTP-01
utilisable.

Le certificat est obtenu et renouvele par le conteneur `certbot`, en mode
webroot, via le volume partage `certbot-webroot`.

### Deux fichiers, deux phases

`install.sh prod` choisit lequel rendre dans `active/default.conf` :

| Fichier | Quand | Role |
|---|---|---|
| `available/bootstrap.conf.template` | avant l'existence du certificat | HTTP seul, sert le challenge ACME |
| `available/production.conf.template` | ensuite | termine TLS, redirige HTTP vers HTTPS, route les cinq surfaces |

L'amorcage n'est pas un confort : un bloc `ssl_certificate` pointant sur un
fichier absent empeche nginx de **demarrer**, alors que le challenge HTTP-01
exige un nginx en marche. Sans les deux phases, la sequence est impossible.

### Substitution : `sed`, pas `envsubst`

`${SERVER_NAME}` est rendu par `install.sh` avec `sed`, comme pour
`prometheus.yml`. Le mecanisme de templates de l'image nginx officielle n'est
**pas** utilise : son entrypoint n'execute `envsubst` que si la commande du
conteneur commence par `nginx`, or elle est remplacee par la boucle de
rechargement du certificat. La configuration n'aurait jamais ete generee et
nginx aurait servi sa page par defaut, sans aucune ecoute sur 443 — constate en
test de fumee avant deploiement.

### Renouvellement

Le conteneur `certbot` tente `certbot renew` toutes les 12 h. nginx recharge sa
configuration toutes les 6 h : c'est le seul moyen pour lui de prendre en compte
un certificat renouvele par un autre conteneur, qui ne peut pas lui envoyer de
signal depuis son propre namespace de processus.
