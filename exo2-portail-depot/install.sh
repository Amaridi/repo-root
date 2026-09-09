#!/usr/bin/env bash
# =============================================================================
# Portail de Depot de Pieces — installation
#
#   ./install.sh local   installe et demarre l'environnement de developpement
#   ./install.sh prod    deploie depuis les images du registry (bloc 5)
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

if [ ! -f .env ]; then
  info "generation de .env (secrets aleatoires)"
  cp .env.example .env
  for placeholder in change_me_postgres change_me_minio change_me_lawyer_secret \
                     change_me_deposit_secret change_me_grafana change_me_seed; do
    secret="$(gen_secret)"
    # Remplacement portable (BSD sed et GNU sed).
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
  WAIT_SERVICES="postgres minio"
  info "demarrage de l'infrastructure locale (postgres, minio)"
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

info "provisionnement du bucket MinIO"
$COMPOSE run --rm minio-init
ok "bucket, politique d'acces, CORS et cycle de vie en place"

# --- 3. Schema et donnees ---------------------------------------------------
# Les fichiers de migration sont ECRITS par le developpeur (prisma migrate dev)
# et versionnes. install.sh ne fait que les APPLIQUER (prisma migrate deploy) :
# un script d'installation ne doit jamais inventer un schema.
if [ -z "$(ls -A backend/prisma/migrations 2>/dev/null | grep -v migration_lock.toml || true)" ]; then
  fail "aucune migration dans backend/prisma/migrations.
         Creer la migration initiale une seule fois, puis la versionner :
             cd backend && npm run prisma:migrate -- --name init"
fi

if [ "$MODE" = "prod" ]; then
  # Aucun code source sur le serveur : les migrations sont jouees PAR l'image
  # du backend, pas par un clone du depot.
  info "application des migrations et du seed (image backend)"
  $COMPOSE run --rm --entrypoint sh backend \
    -c "npx prisma migrate deploy && npx prisma db seed"
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
  Grafana        : ${PUBLIC_BASE_URL}/grafana
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
EOF
fi
printf '\n'
cat <<EOF
  Compte avocat de demonstration
    identifiant : ${SEED_LAWYER_EMAIL}
    mot de passe: ${SEED_LAWYER_PASSWORD}
EOF
printf '\n'
