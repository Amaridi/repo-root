#!/bin/sh
# Provisionne le bucket de depot. Idempotent.
#
# Toute erreur est FATALE : un provisionnement qui echoue a moitie en silence
# est pire qu un provisionnement qui refuse de continuer.
set -eu

echo "[minio-init] connexion..."
mc alias set local http://minio:9000 "$S3_ACCESS_KEY" "$S3_SECRET_KEY" >/dev/null

echo "[minio-init] bucket '$S3_BUCKET'..."
mc mb --ignore-existing "local/$S3_BUCKET"

# Bucket strictement prive : aucun acces anonyme. Tout passe par presigned URL.
mc anonymous set none "local/$S3_BUCKET"

# Versioning : filet de securite contre un ecrasement de cle.
mc version enable "local/$S3_BUCKET"

echo "[minio-init] verification de la politique d acces..."
mc anonymous get "local/$S3_BUCKET"

# --- Ce qui N EST PAS fait ici, et pourquoi ---------------------------------
#
# CORS : MinIO n implemente pas la configuration CORS par bucket
# (`mc cors set` repond « functionality that is not implemented »). Elle se
# declare au niveau du SERVEUR, via MINIO_API_CORS_ALLOW_ORIGIN — voir le
# service minio dans docker-compose.yml. Sans cette variable, MinIO renvoie
# l en-tete pour n importe quelle origine.
#
# Cycle de vie : `mc ilm import` refuse une regle limitee a
# AbortIncompleteMultipartUpload, et `mc ilm rule add` n expose pas de drapeau
# equivalent. Ce n est pas bloquant : les depots se font par PUT simple, pas en
# multipart, et MinIO purge de lui-meme les multipart inacheves. Le vrai residu
# a nettoyer est cote base — les lignes Document restees PENDING dont les octets
# ne sont jamais arrives. C est un point d amelioration connu, pas un acquis
# silencieux.

echo "[minio-init] termine."
