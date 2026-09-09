#!/usr/bin/env bash
# =============================================================================
# Fabrique le paquet a deposer sur le serveur.
#
# L'enonce impose qu'AUCUN CODE SOURCE ne se trouve sur le serveur : uniquement
# de la configuration, un compose, un .env et du nginx. Ce script materialise
# cette regle au lieu de la confier a la vigilance d'un `scp -r`.
#
# Il liste EXPLICITEMENT ce qui part — une liste blanche, jamais une exclusion :
# une exclusion oublie toujours le nouveau dossier ajoute six semaines plus
# tard. Il verifie ensuite que rien d'interdit ne s'est glisse dedans.
#
#   ./infra/make-server-bundle.sh
#   -> dist-server/            arborescence prete a copier
#   -> dist-server.tar.gz      la meme chose, pour un scp unique
# =============================================================================
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

OUT="dist-server"
rm -rf "$OUT" "$OUT.tar.gz"

# --- Liste blanche ----------------------------------------------------------
FILES="
docker-compose.prod.yml
install.sh
.env.prod.example
infra/minio/init.sh
infra/nginx/available/bootstrap.conf.template
infra/nginx/available/production.conf.template
infra/prometheus/prometheus.yml.template
infra/prometheus/rules/alerts.yml
infra/grafana/provisioning/datasources/prometheus.yml
infra/grafana/provisioning/dashboards/dashboards.yml
infra/grafana/dashboards/depot-overview.json
"

for f in $FILES; do
  [ -f "$f" ] || { printf 'manquant : %s\n' "$f" >&2; exit 1; }
  mkdir -p "$OUT/$(dirname "$f")"
  cp "$f" "$OUT/$f"
done

# Dossiers vides attendus par le provisioning Grafana : sans eux, Grafana
# journalise une erreur par sous-dossier absent, et un relecteur qui ouvre les
# journaux ne peut pas savoir qu'elle est inoffensive.
mkdir -p "$OUT/infra/grafana/provisioning/plugins" "$OUT/infra/grafana/provisioning/alerting"
touch "$OUT/infra/grafana/provisioning/plugins/.gitkeep" \
      "$OUT/infra/grafana/provisioning/alerting/.gitkeep"

# Dossiers que install.sh remplit sur le serveur.
mkdir -p "$OUT/infra/nginx/active" "$OUT/infra/nginx/secrets"

chmod +x "$OUT/install.sh"

# --- Verifications ----------------------------------------------------------
# Le paquet est controle APRES fabrication, pas seulement construit avec soin :
# c'est la difference entre une intention et une garantie.
fail=0

if find "$OUT" -type f \( -name '*.ts' -o -name '*.tsx' -o -name '*.js' -o -name '*.jsx' \) \
     | grep -q .; then
  echo "ECHEC : du code source figure dans le paquet" >&2
  fail=1
fi

for interdit in "$OUT/backend" "$OUT/frontend" "$OUT/.env" "$OUT/node_modules"; do
  if [ -e "$interdit" ]; then
    echo "ECHEC : $interdit ne doit pas etre livre" >&2
    fail=1
  fi
done

# Toute valeur de secret qui n'est pas restee un placeholder est un secret en
# clair. Le paquet part sur un serveur partage : il ne doit en contenir aucun.
SECRET_KEYS='^(POSTGRES_PASSWORD|S3_SECRET_KEY|JWT_[A-Z_]*SECRET|GRAFANA_ADMIN_PASSWORD|PROMETHEUS_BASIC_PASSWORD|SEED_LAWYER_PASSWORD)='
while IFS= read -r ligne; do
  [ -n "$ligne" ] || continue
  case "$ligne" in
    *=change_me*) : ;;
    *)
      echo "ECHEC : secret en clair dans le paquet -> $ligne" >&2
      fail=1
      ;;
  esac
done <<SECRETS
$(grep -rhE "$SECRET_KEYS" "$OUT" 2>/dev/null || true)
SECRETS

[ "$fail" -eq 0 ] || exit 1

tar -czf "$OUT.tar.gz" "$OUT"

printf '\nPaquet pret : %s.tar.gz (%s)\n\n' "$OUT" "$(du -h "$OUT.tar.gz" | cut -f1)"
find "$OUT" -type f | sort | sed 's/^/  /'
printf '\n  %s fichiers, aucun code source, aucun secret.\n\n' "$(find "$OUT" -type f | wc -l | tr -d ' ')"
