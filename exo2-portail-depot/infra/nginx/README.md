# nginx — routage applicatif

Ce nginx n'est **pas** un proxy d'entree public. Le serveur d'exercice dispose
deja d'un proxy frontal mutualise sur le port 443. Le role de ce nginx est
uniquement de reunir, derriere un port unique de la plage assignee, les quatre
surfaces de l'application.

```
127.0.0.1:22443  (ou 22480)
  /                    -> fichiers statiques de la SPA (fallback index.html)
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

## Question ouverte — a trancher avant le bloc 5

Le mode de terminaison TLS du proxy frontal determine ce que ce nginx doit
faire, et les deux cas s'excluent :

| Cas | Ce que fait ce nginx | Certificat |
|---|---|---|
| Le proxy frontal **termine** TLS et transmet en HTTP clair | ecoute en HTTP sur 22480, rien de plus | gere par la plateforme |
| Le proxy frontal fait du **passthrough** SNI sur 443 | termine TLS lui-meme sur 22443 | a obtenir et renouveler nous-memes |

Dans le second cas, l'obtention d'un certificat Let's Encrypt exige que le
challenge ACME atteigne ce serveur : soit HTTP-01, si le proxy frontal
acheminie aussi le port 80 vers nos ports, soit DNS-01, ce qui suppose un acces
a la zone DNS du domaine. Ni l'un ni l'autre n'est acquis a ce stade.

La configuration sera ecrite pour couvrir les deux cas (bloc `listen 22480;`
toujours present, bloc TLS active par variable), mais **la reponse de
l'equipe DIV Protocol est un prerequis** : elle determine si le certificat est
fourni ou a produire.
