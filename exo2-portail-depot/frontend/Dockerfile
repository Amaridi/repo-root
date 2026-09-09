# =============================================================================
# Image de production du frontend : les fichiers statiques compiles, servis par
# un nginx minimal.
#
# Aucune variable d environnement n est necessaire, ni au build ni a
# l execution : le client HTTP appelle `/api` en RELATIF (voir
# src/lib/api.ts). L image est donc identique quel que soit le domaine servi,
# et il n existe aucun risque qu une URL de developpement soit figee dans le
# bundle.
# =============================================================================

FROM node:22-bookworm-slim AS builder

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

COPY . .

# `npm run build` enchaine chakra typegen, tsc -b puis vite build. Le typegen
# est indispensable : sans lui les variantes de recette maison (variant="div")
# ne sont pas typees et la compilation echoue.
RUN npm run build

# -----------------------------------------------------------------------------

FROM nginx:1.27-alpine AS runtime

# Uniquement des fichiers statiques : ni Node, ni source, ni dependance.
COPY --from=builder /app/dist /usr/share/nginx/html
COPY docker/frontend.conf /etc/nginx/conf.d/default.conf

# Pas de HEALTHCHECK ici : la passerelle nginx et le compose s en chargent.
