# =============================================================================
# Image de production du backend NestJS.
#
# Construite UNIQUEMENT sur la machine de developpement, publiee sur GHCR, puis
# tiree sur le serveur : aucune compilation, aucun code source et aucun
# gestionnaire de paquets n intervient cote serveur.
#
# Aucun secret n entre ici. Pas d ARG, pas de COPY .env : toute la
# configuration vient de l environnement au demarrage du conteneur, et
# env.validation.ts fait echouer le boot bruyamment si une variable manque.
# =============================================================================

# Debian bookworm et non Alpine : Prisma a besoin d OpenSSL 3.0 et le schema
# declare la cible `debian-openssl-3.0.x`. Sur Alpine (musl), le Query Engine
# est introuvable et l erreur ne se voit qu au premier appel a la base.
FROM node:22-bookworm-slim AS builder

WORKDIR /app

# argon2 est un module natif : sans chaine de compilation, `npm ci` echoue ou
# retombe sur une implementation degradee.
RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 make g++ openssl ca-certificates \
 && rm -rf /var/lib/apt/lists/*

# Les dependances d abord, dans leur propre couche : le cache Docker n est
# invalide que lorsque le lockfile change, pas a chaque modification de source.
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

# Le client Prisma est genere AVANT la compilation : le code TypeScript importe
# ses types.
COPY prisma ./prisma
RUN npx prisma generate

COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
RUN npm run build

# Le seed est compile en JavaScript autonome.
#
# Pourquoi ne pas garder `prisma db seed` avec ts-node : cela imposerait
# ts-node et les devDependencies dans l image finale. Le script est autonome
# (il instancie son propre PrismaClient), il suffit donc de le lancer avec
# node. Seul `prisma migrate deploy` reclame encore la CLI, qui est pour cette
# raison une dependance de production et non de developpement.
COPY tsconfig.seed.json ./
RUN npx tsc -p tsconfig.seed.json

# Elagage APRES la compilation : l image finale ne recoit que les dependances
# de production, avec le binaire natif d argon2 deja compile pour cette base.
#
# Le moteur Prisma pour Windows est supprime ICI, dans l etape de build, et non
# dans l image finale : les couches Docker sont ADDITIVES, un `rm` dans une
# couche ulterieure masque le fichier sans rien economiser. Le schema declare
# trois binaryTargets pour permettre le developpement depuis WSL et depuis
# Windows sur un meme node_modules ; 21 Mo de DLL n ont pas a ralentir chaque
# `docker pull` du serveur.
RUN npm prune --omit=dev  && find node_modules -name 'query_engine-windows.dll.node' -delete

# -----------------------------------------------------------------------------

FROM node:22-bookworm-slim AS runtime

# openssl est exige par le Query Engine de Prisma a l execution.
RUN apt-get update \
 && apt-get install -y --no-install-recommends openssl ca-certificates \
 && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production
# En conteneur, ecouter sur la boucle locale rendrait le service injoignable
# depuis nginx. Le port n est pas publie sur l hote : l exposition reste nulle.
ENV BIND_ADDRESS=0.0.0.0

WORKDIR /app

# node_modules vient du builder, deja elague et deja compile pour cette base :
# aucune installation, donc aucun acces reseau, au demarrage.
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/dist-seed ./dist-seed
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/package.json ./package.json


# Utilisateur non privilegie fourni par l image de base.
USER node

# Aucun EXPOSE : le port vient de la configuration, et publier un port est une
# decision du compose, pas de l image.
CMD ["node", "dist/main.js"]
