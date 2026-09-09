#!/bin/sh
# Provisionne le bucket de depot. Idempotent.
set -eu

echo "[minio-init] connexion..."
mc alias set local http://minio:9000 "$S3_ACCESS_KEY" "$S3_SECRET_KEY" >/dev/null

echo "[minio-init] bucket '$S3_BUCKET'..."
mc mb --ignore-existing "local/$S3_BUCKET"

# Bucket strictement prive : aucun acces anonyme. Tout passe par presigned URL.
mc anonymous set none "local/$S3_BUCKET"

# Versioning : filet de securite contre un ecrasement de cle.
mc version enable "local/$S3_BUCKET" || true

# Les objets confirmes ne sont jamais supprimes ; on nettoie les uploads
# interrompus (multipart orphelins) au bout d'un jour.
cat > /tmp/lifecycle.json <<JSON
{
  "Rules": [
    {
      "ID": "abort-incomplete-uploads",
      "Status": "Enabled",
      "Filter": { "Prefix": "" },
      "AbortIncompleteMultipartUpload": { "DaysAfterInitiation": 1 }
    }
  ]
}
JSON
mc ilm import "local/$S3_BUCKET" < /tmp/lifecycle.json || echo "[minio-init] lifecycle ignore (non bloquant)"

# CORS : le navigateur fait le PUT directement sur MinIO. Sans ca, l'upload
# est bloque par la politique d'origine. En prod l'origine == le bucket est
# derriere le meme hostname, donc la requete est same-origin.
cat > /tmp/cors.json <<JSON
{
  "CORSRules": [
    {
      "AllowedOrigin": ["$CORS_ORIGIN"],
      "AllowedMethod": ["GET", "PUT", "HEAD"],
      "AllowedHeader": ["*"],
      "ExposeHeader": ["ETag"],
      "MaxAgeSeconds": 3000
    }
  ]
}
JSON
mc cors set "local/$S3_BUCKET" /tmp/cors.json || echo "[minio-init] cors ignore (non bloquant)"

echo "[minio-init] termine."
