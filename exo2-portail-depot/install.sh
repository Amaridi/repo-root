#!/usr/bin/env bash
# =============================================================================
# Portail de Depot de Pieces — installation
#
#   ./install.sh local   installe et demarre l'environnement de developpement
#   ./install.sh prod    deploie sur le serveur depuis les images du registre
#
# En mode prod, ce script est le SEUL element executable present sur le serveur.
# Il ne compile rien et ne clone rien : il tire des images, rend deux fichiers de
# configuration, obtient le certificat TLS, puis demarre la stack.
#
# Idempotent : peut etre rejoue sans effet de bord.
# Se termine en affichant les URLs et les identifiants de demonstration.
# =============================================================================
set -euo pipefail

MODE="${1:-local}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT"

info() { printf '\033[0;34m[install]\033[0m %s\n' "$1"; }
ok()   { printf '\033[0;32m[  ok  ]\033[0m %s\n' "$1"; }
warn() { printf '\033[0;33m[ avert]\033[0m %s\n' "$1"; }
fail() { printf '\033[0;31m[ echec]\033[0m %s\n' "$1" >&2; exit 1; }

# Sans ce piege, `set -e` fait mourir le script SANS message : on ne sait pas
# quelle etape a echoue. C'est exactement ce qui rend un script d'installation
# impossible a diagnostiquer.
trap 'printf "\033[0;31m[ echec]\033[0m interruption a la ligne %s : %s\n" "$LINENO" "$BASH_COMMAND" >&2' ERR

# --- 0. Prerequis -----------------------------------------------------------
command -v docker >/dev/null 2>&1 || fail "docker est requis. https://docs.docker.com/get-docker/"
docker compose version >/dev/null 2>&1 || fail "docker compose v2 est requis (plugin 'docker compose', pas 'docker-compose')."
command -v openssl >/dev/null 2>&1 || fail "openssl est requis pour generer les secrets."

# Le demon doit etre joignable PAR CET UTILISATEUR. Le cas le plus frequent sous
# Linux n'est pas un demon arrete mais un utilisateur absent du groupe docker.
if ! docker info >/dev/null 2>&1; then
  echo
  warn "le demon Docker n'est pas joignable."
  cat <<'EOF'

  Si le message est "permission denied ... /var/run/docker.sock", l'utilisateur
  n'appartient pas au groupe docker :

      sudo usermod -aG docker "$USER"
      newgrp docker            # ou fermer puis rouvrir la session

  Sinon, demarrer le demon :  sudo systemctl start docker
  Sous Windows ou macOS : lancer Docker Desktop et attendre l'etat "running".

EOF
  exit 1
fi
ok "docker operationnel"

if [ "$MODE" != "local" ] && [ "$MODE" != "prod" ]; then
  fail "mode inconnu : '$MODE'. Utiliser 'local' ou 'prod'."
fi

# --- 1. Secrets -------------------------------------------------------------
# Les secrets ne sont jamais dans le depot : ils sont generes ici, au premier
# passage, dans un .env ignore par git.
gen_secret() { openssl rand -base64 32 | tr -d '\n/+=' | cut -c1-32; }

# Le gabarit differe selon le mode : en production les services se joignent par
# leur nom docker et les points d'entree sont 22400/22401, pas les ports de
# developpement.
if [ "$MODE" = "prod" ]; then
  ENV_TEMPLATE=".env.prod.example"
else
  ENV_TEMPLATE=".env.example"
fi

if [ ! -f .env ]; then
  [ -f "$ENV_TEMPLATE" ] || fail "$ENV_TEMPLATE absent : impossible de generer .env."
  info "generation de .env depuis $ENV_TEMPLATE (secrets aleatoires)"
  cp "$ENV_TEMPLATE" .env
  for placeholder in change_me_postgres change_me_minio change_me_lawyer_secret \
                     change_me_deposit_secret change_me_grafana change_me_seed \
                     change_me_prometheus; do
    secret="$(gen_secret)"
    # Remplacement GLOBAL et non sur la premiere occurrence : le mot de passe
    # PostgreSQL figure a la fois dans POSTGRES_PASSWORD et dans DATABASE_URL.
    # Les desynchroniser rendrait la base injoignable avec un message obscur.
    # Portable BSD sed et GNU sed.
    sed -i.bak "s|${placeholder}|${secret}|g" .env && rm -f .env.bak
  done
  chmod 600 .env
  ok ".env cree"
else
  ok ".env existant conserve"
fi

set -a
# shellcheck disable=SC1091
. ./.env
set +a

# En production, deux valeurs ne peuvent PAS etre devinees par ce script : le
# compte proprietaire des images et le hostname. Les laisser en placeholder
# produirait un `docker pull` sur un depot inexistant, ou un certificat demande
# pour le mauvais domaine — autant echouer ici, avec la marche a suivre.
if [ "$MODE" = "prod" ]; then
  case "${IMAGE_OWNER:-}" in
    ''|change_me*) fail "IMAGE_OWNER n'est pas renseigne dans .env (compte GitHub proprietaire des images, en minuscules)." ;;
  esac
  [ -n "${SERVER_NAME:-}" ] || fail "SERVER_NAME est requis dans .env."
  [ -n "${PORT_HTTP:-}" ] || fail "PORT_HTTP est requis dans .env (22400)."
  [ -n "${PORT_HTTPS:-}" ] || fail "PORT_HTTPS est requis dans .env (22401)."
  [ -n "${CERTBOT_EMAIL:-}" ] || fail "CERTBOT_EMAIL est requis dans .env."
  # Le hostname doit etre coherent avec l'URL publique, sinon les liens de depot
  # et le certificat divergent.
  case "$PUBLIC_BASE_URL" in
    "https://$SERVER_NAME") : ;;
    *) fail "PUBLIC_BASE_URL ($PUBLIC_BASE_URL) doit valoir exactement https://$SERVER_NAME" ;;
  esac
fi

# --- 1 bis. Configuration Prometheus ---------------------------------------
# Prometheus ne substitue pas les variables d'environnement dans sa propre
# configuration : le fichier est donc RENDU ici depuis un gabarit versionne.
# `sed` plutot qu'`envsubst` pour ne pas ajouter gettext aux prerequis.
#
# La cible depend du mode : en developpement le backend tourne sur l'hote et
# Prometheus le joint par host.docker.internal ; en production les deux sont
# dans le meme reseau compose.
if [ "$MODE" = "prod" ]; then
  BACKEND_SCRAPE_TARGET="backend:${PORT_BACKEND}"
  DEPLOY_ENV="production"
else
  BACKEND_SCRAPE_TARGET="host.docker.internal:${PORT_BACKEND}"
  DEPLOY_ENV="development"
fi

info "rendu de la configuration Prometheus (cible ${BACKEND_SCRAPE_TARGET})"
sed "s|[$]{BACKEND_SCRAPE_TARGET}|${BACKEND_SCRAPE_TARGET}|g" infra/prometheus/prometheus.yml.template > infra/prometheus/prometheus.yml.tmp
sed "s|[$]{DEPLOY_ENV}|${DEPLOY_ENV}|g" infra/prometheus/prometheus.yml.tmp > infra/prometheus/prometheus.yml
rm -f infra/prometheus/prometheus.yml.tmp

# Un placeholder oublie rendrait la cible injoignable et l'alerte
# BackendIndisponible crierait sur une fausse panne : autant echouer ici.
if grep -q '[$]{[A-Z]' infra/prometheus/prometheus.yml; then
  fail "des variables non substituees subsistent dans infra/prometheus/prometheus.yml"
fi
ok "prometheus.yml genere"

# --- 2. Infrastructure ------------------------------------------------------
if [ "$MODE" = "prod" ]; then
  [ -f docker-compose.prod.yml ] || fail "docker-compose.prod.yml absent (livre au bloc 5)."
  COMPOSE="docker compose -f docker-compose.prod.yml"
  # Services durables : ceux qu'on attend en bonne sante.
  WAIT_SERVICES="postgres minio backend frontend prometheus grafana"
  info "recuperation des images depuis ${REGISTRY}/${IMAGE_OWNER} (tag ${IMAGE_TAG})"
  $COMPOSE pull
else
  COMPOSE="docker compose -f docker-compose.yml"
  WAIT_SERVICES="postgres minio prometheus grafana"
  info "demarrage de l'infrastructure locale (postgres, minio, prometheus, grafana)"
fi

# --- 2 bis. nginx et certificat TLS (production uniquement) ----------------
if [ "$MODE" = "prod" ]; then
  mkdir -p infra/nginx/active infra/nginx/secrets

  # Rendu de la configuration nginx de la phase demandee.
  #
  # sed, et non le mecanisme de templates de l'image nginx officielle : son
  # entrypoint n'execute envsubst que si la commande du conteneur commence par
  # `nginx`, or elle est remplacee par une boucle de rechargement. La
  # configuration n'aurait jamais ete generee et nginx aurait servi sa page par
  # defaut, sans ecoute sur 443 — constate en test de fumee avant deploiement.
  #
  # Meme mecanisme que pour prometheus.yml : une seule facon de rendre un
  # fichier de configuration dans tout le projet.
  render_nginx() {
    phase="$1"
    src="infra/nginx/available/${phase}.conf.template"
    [ -f "$src" ] || fail "gabarit nginx introuvable : $src"
    sed "s|[$]{SERVER_NAME}|${SERVER_NAME}|g" "$src" > infra/nginx/active/default.conf
    if grep -q '[$]{[A-Z]' infra/nginx/active/default.conf; then
      fail "des variables non substituees subsistent dans infra/nginx/active/default.conf"
    fi
    ok "configuration nginx rendue (phase ${phase})"
  }

  # Authentification basique devant Prometheus, qui n'en a aucune.
  # `openssl passwd -apr1` evite d'ajouter apache2-utils aux prerequis.
  if [ ! -f infra/nginx/secrets/prometheus.htpasswd ]; then
    info "generation de l'authentification basique de Prometheus"
    printf '%s:%s\n' "$PROMETHEUS_BASIC_USER" \
      "$(openssl passwd -apr1 "$PROMETHEUS_BASIC_PASSWORD")" \
      > infra/nginx/secrets/prometheus.htpasswd
    chmod 600 infra/nginx/secrets/prometheus.htpasswd
    ok "htpasswd genere"
  fi

  CERT_LIVE="/etc/letsencrypt/live/${SERVER_NAME}/fullchain.pem"

  # Le certificat existe-t-il DEJA dans le volume ? On interroge le volume plutot
  # que le disque de l'hote : les certificats vivent dans un volume docker, pas
  # dans l'arborescence du depot.
  cert_present() {
    # L image certbot est de toute facon necessaire : la reutiliser evite de
    # tirer une image de plus sur le serveur juste pour un `test -f`.
    $COMPOSE run --rm --entrypoint sh certbot -c "test -f $CERT_LIVE" >/dev/null 2>&1
  }

  if cert_present; then
    ok "certificat deja present pour ${SERVER_NAME}"
  else
    # ---------------------------------------------------------------------------
    # PHASE 1 : amorcage.
    #
    # Un bloc ssl_certificate pointant sur un fichier absent empeche nginx de
    # DEMARRER. Or le challenge HTTP-01 exige un nginx en marche. On demarre donc
    # avec une configuration HTTP seule, le temps d'obtenir le certificat.
    # ---------------------------------------------------------------------------
    info "phase 1 : nginx en configuration d'amorcage (HTTP seul)"
    render_nginx bootstrap
    $COMPOSE up -d --force-recreate nginx
    ok "nginx repond sur 127.0.0.1:${PORT_HTTP} pour le challenge ACME"

    # --entrypoint certbot est OBLIGATOIRE sur chaque `run`.
    #
    # Le service certbot du compose a pour entrypoint une boucle de
    # renouvellement (`while :; do certbot renew; sleep 12h; done`). Sans
    # surcharge, `docker compose run certbot certonly ...` lancerait cette
    # boucle en ignorant les arguments : l'installation se figerait sans jamais
    # demander de certificat, et sans message d'erreur.
    CERTBOT_ARGS="certonly --webroot --webroot-path /var/www/certbot \
      -d ${SERVER_NAME} --email ${CERTBOT_EMAIL} \
      --agree-tos --no-eff-email --non-interactive"

    # Repetition a blanc AVANT toute demande reelle.
    #
    # Let's Encrypt limite a 5 echecs par heure et par domaine : une
    # configuration fautive epuiserait le quota et bloquerait le deploiement
    # pour une heure. Le dry-run utilise l'environnement de test, sans quota
    # significatif, et valide exactement le meme chemin de challenge.
    info "repetition a blanc de l'emission du certificat (dry-run)"
    # shellcheck disable=SC2086
    if ! $COMPOSE run --rm --entrypoint certbot certbot $CERTBOT_ARGS --dry-run; then
      fail "le dry-run certbot a echoue. Le challenge HTTP-01 n'atteint pas ce serveur.
         Verifier : le proxy frontal relaie-t-il bien le port 80 vers 127.0.0.1:${PORT_HTTP} ?
         Test manuel :
             echo ok > /tmp/t && docker compose -f docker-compose.prod.yml cp /tmp/t nginx:/var/www/certbot/.well-known/acme-challenge/t
             curl -v http://${SERVER_NAME}/.well-known/acme-challenge/t"
    fi
    ok "dry-run reussi : le challenge est bien relaye"

    if [ "${CERTBOT_STAGING:-0}" = "1" ]; then
      warn "CERTBOT_STAGING=1 : le certificat emis ne sera PAS reconnu par les navigateurs"
      CERTBOT_ARGS="$CERTBOT_ARGS --staging"
    fi

    info "emission du certificat reel pour ${SERVER_NAME}"
    # shellcheck disable=SC2086
    $COMPOSE run --rm --entrypoint certbot certbot $CERTBOT_ARGS
    cert_present || fail "certbot s'est termine sans erreur mais le certificat est absent du volume."
    ok "certificat obtenu"

  fi

  # ---------------------------------------------------------------------------
  # PHASE 2 : configuration complete. nginx termine TLS, redirige HTTP vers
  # HTTPS (sauf le challenge, sans quoi les renouvellements echoueraient) et
  # route les quatre surfaces.
  # ---------------------------------------------------------------------------
  info "phase 2 : nginx en configuration de production (TLS termine ici)"
  render_nginx production
fi

# --wait n'est applique QU'AUX services durables.
#
# Pourquoi : `docker compose up --wait` retourne un code d'erreur des qu'un
# conteneur se termine, y compris avec un code de sortie 0. minio-init est
# precisement un conteneur a usage unique. Le lancer dans le meme `up --wait`
# faisait donc echouer le script juste apres, silencieusement.
# shellcheck disable=SC2086
$COMPOSE up -d --wait $WAIT_SERVICES
ok "conteneurs durables demarres et sains"

if [ "$MODE" = "prod" ]; then
  # --force-recreate : nginx tourne peut-etre encore avec la configuration
  # d'amorcage. Sans recreation, le gabarit n'est pas re-substitue et le service
  # resterait bloque en page 503.
  info "activation de la configuration nginx de production"
  $COMPOSE up -d --force-recreate nginx certbot
  ok "nginx et le renouvellement automatique sont en place"
fi

info "provisionnement du bucket MinIO"
$COMPOSE run --rm minio-init
ok "bucket et politique d'acces en place"

# --- 2 bis. Observabilite prete ---------------------------------------------
# Grafana n'a pas de healthcheck dans le compose (rien ne garantit wget ou curl
# dans l'image) : la disponibilite est verifiee ICI, depuis l'hote, contre le
# port publie. C'est de toute facon le point de vue qui compte.
#
# La verification est facultative : sans curl on n'echoue pas l'installation
# pour une sonde de confort, on le dit.
if [ "$MODE" != "prod" ] && command -v curl >/dev/null 2>&1; then
  info "attente du provisionnement Grafana"
  grafana_ready=0
  for _ in $(seq 1 30); do
    if curl -fsS "http://127.0.0.1:${PORT_GRAFANA}/api/health" >/dev/null 2>&1; then
      grafana_ready=1
      break
    fi
    sleep 2
  done
  if [ "$grafana_ready" = "1" ]; then
    ok "Grafana repond — datasource et dashboard provisionnes depuis infra/grafana/"
  else
    warn "Grafana n'a pas repondu en 60 s. Diagnostic : docker compose logs grafana"
  fi
elif [ "$MODE" != "prod" ]; then
  warn "curl absent : disponibilite de Grafana non verifiee (sans consequence sur l'installation)"
fi

# --- 3. Schema et donnees ---------------------------------------------------
# Les fichiers de migration sont ECRITS par le developpeur (prisma migrate dev)
# et versionnes. install.sh ne fait que les APPLIQUER (prisma migrate deploy) :
# un script d'installation ne doit jamais inventer un schema.
# En production il n'y a PAS de dossier backend/ sur le serveur : les fichiers de
# migration voyagent DANS l'image. Ce controle ne vaut donc qu'en local.
if [ "$MODE" != "prod" ] && \
   [ -z "$(ls -A backend/prisma/migrations 2>/dev/null | grep -v migration_lock.toml || true)" ]; then
  fail "aucune migration dans backend/prisma/migrations.
         Creer la migration initiale une seule fois, puis la versionner :
             cd backend && npm run prisma:migrate -- --name init"
fi

if [ "$MODE" = "prod" ]; then
  # Aucun code source sur le serveur : les migrations sont jouees PAR l'image
  # du backend, pas par un clone du depot.
  info "application des migrations et du seed (image backend)"
  # `node dist-seed/seed.js` et non `prisma db seed` : ce dernier passerait par
  # ts-node, absent de l'image de production. Le seed y est compile en
  # JavaScript autonome.
  $COMPOSE run --rm --entrypoint sh backend \
    -c "npx prisma migrate deploy && node dist-seed/seed.js"
else
  info "installation des dependances backend"
  ( cd backend && npm install --no-fund --no-audit --loglevel=error )
  info "generation du client Prisma"
  ( cd backend && npm run prisma:generate >/dev/null )
  info "application des migrations"
  ( cd backend && npm run prisma:deploy )
  info "creation du compte avocat de demonstration"
  ( cd backend && npm run prisma:seed )
  info "installation des dependances frontend"
  ( cd frontend && npm install --no-fund --no-audit --loglevel=error )
fi
ok "base de donnees prete"

# --- 4. Recapitulatif -------------------------------------------------------
printf '\n'
ok "installation terminee"
printf '\n'
if [ "$MODE" = "prod" ]; then
  cat <<EOF
  Application    : ${PUBLIC_BASE_URL}
  API            : ${PUBLIC_BASE_URL}/api
  Documentation  : ${PUBLIC_BASE_URL}/api/docs
  Grafana        : ${PUBLIC_BASE_URL}/grafana/        (compte ci-dessous)
  Prometheus     : ${PUBLIC_BASE_URL}/prometheus/     (auth basique : ${PROMETHEUS_BASIC_USER})

  Points d'entree publies, sur 127.0.0.1 uniquement :
    HTTP  127.0.0.1:${PORT_HTTP}   <- port 80 externe  (redirige vers HTTPS, sauf ACME)
    HTTPS 127.0.0.1:${PORT_HTTPS}  <- port 443 externe (TLS termine par notre nginx)

  Aucun autre service ne publie de port : PostgreSQL, MinIO, le backend, le
  frontend, Prometheus et Grafana ne sont joignables que par le reseau interne.

  Renouvellement du certificat : conteneur certbot, tentative toutes les 12 h ;
  nginx recharge sa configuration toutes les 6 h.
EOF
else
  cat <<EOF
  A lancer dans deux terminaux :
    cd backend  && npm run start:dev     -> http://127.0.0.1:${PORT_BACKEND}/api
    cd frontend && npm run dev           -> http://127.0.0.1:22470

  Application    : http://127.0.0.1:22470
  Charte         : http://127.0.0.1:22470/_charte
  API            : http://127.0.0.1:${PORT_BACKEND}/api
  Documentation  : http://127.0.0.1:${PORT_BACKEND}/api/docs
  Console MinIO  : http://127.0.0.1:${PORT_MINIO_CONSOLE}
  Grafana        : http://127.0.0.1:${PORT_GRAFANA}     (dashboard "Portail de depot")
  Prometheus     : http://127.0.0.1:${PORT_PROMETHEUS}  (cibles : /targets, alertes : /alerts)
EOF
fi
printf '\n'
cat <<EOF
  Compte avocat de demonstration
    identifiant : ${SEED_LAWYER_EMAIL}
    mot de passe: ${SEED_LAWYER_PASSWORD}

  Grafana
    identifiant : ${GRAFANA_ADMIN_USER}
    mot de passe: ${GRAFANA_ADMIN_PASSWORD}
EOF
printf '\n'
