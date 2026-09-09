import { createSystem, defaultConfig, defineConfig, defineRecipe } from '@chakra-ui/react';

/**
 * Charte graphique DIV Protocol.
 *
 * Toutes les valeurs de la charte sont declarees ICI, une seule fois, en
 * tokens. Aucun composant de l'application ne doit contenir de code
 * hexadecimal : si la charte evolue, ce fichier est le seul a changer.
 *
 * Site en light only : aucun bloc _dark, aucun ColorModeProvider.
 */

const buttonRecipe = defineRecipe({
  base: {
    fontWeight: '600',
    borderRadius: 'full',
    transitionProperty: 'background-color, color, box-shadow',
    transitionDuration: 'fast',
  },
  variants: {
    variant: {
      // Bouton primaire de la charte : fond primary / texte blanc, et au
      // survol l'inverse — fond accent tres clair, texte primary, contour
      // inset 1px (inset : le bouton ne bouge pas d'un pixel au hover,
      // contrairement a une vraie bordure).
      div: {
        bg: 'brand.primary',
        color: 'white',
        px: '24px',
        py: '14px',
        _hover: {
          bg: 'brand.accentBg',
          color: 'brand.primary',
          boxShadow: 'inset 0 0 0 1px var(--chakra-colors-brand-primary)',
        },
        _disabled: { opacity: 0.45, cursor: 'not-allowed' },
      },
      // Variante secondaire, deduite de la charte pour les actions non
      // primaires (annuler, retour).
      divGhost: {
        bg: 'transparent',
        color: 'brand.grey',
        px: '24px',
        py: '14px',
        boxShadow: 'inset 0 0 0 1px var(--chakra-colors-brand-border)',
        _hover: { bg: 'brand.accentBg', color: 'brand.primary' },
      },
    },
  },
});

const config = defineConfig({
  // Inter en 400 (corps) et 600 (titres et CTA), conformement a la charte.
  globalCss: {
    'html, body': {
      fontFamily: 'body',
      fontWeight: '400',
      color: 'brand.text',
      bg: 'white',
      colorScheme: 'light',
    },
    'h1, h2, h3, h4': { fontWeight: '600' },
  },
  theme: {
    tokens: {
      fonts: {
        body: { value: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif" },
        heading: { value: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif" },
      },
      colors: {
        brand: {
          primary: { value: '#5100FF' },
          secondary: { value: '#916ED8' },
          text: { value: '#000000' },
          grey: { value: '#585858' },
          greyLight: { value: '#CECECE' },
          border: { value: '#E9E9E9' },
          accentBg: { value: '#F7F6FF' },
          accentSoft: { value: '#DBCDFF' },
        },
        state: {
          successFg: { value: '#12AC64' },
          successBg: { value: '#D9FFED' },
          dangerFg: { value: '#FF4C4C' },
          dangerBg: { value: '#FFD0D0' },
          warningFg: { value: '#DA9705' },
          warningBg: { value: '#FFEDCA' },
          infoFg: { value: '#52A0EE' },
          infoBg: { value: '#DBEDFF' },
        },
      },
      // 4 / 8 / 12 px, et full pour boutons et pills.
      radii: {
        sm: { value: '4px' },
        md: { value: '8px' },
        lg: { value: '12px' },
        full: { value: '999px' },
      },
    },
    // Tokens semantiques : les composants parlent en INTENTION
    // (fg.muted, bg.surface) et non en couleur. C'est ce qui garantit que la
    // charte reste respectee sans discipline permanente.
    semanticTokens: {
      colors: {
        fg: {
          DEFAULT: { value: '{colors.brand.text}' },
          muted: { value: '{colors.brand.grey}' },
          subtle: { value: '{colors.brand.greyLight}' },
          accent: { value: '{colors.brand.primary}' },
        },
        bg: {
          DEFAULT: { value: 'white' },
          surface: { value: 'white' },
          accent: { value: '{colors.brand.accentBg}' },
          soft: { value: '{colors.brand.accentSoft}' },
        },
        border: {
          DEFAULT: { value: '{colors.brand.border}' },
        },
      },
    },
    recipes: {
      button: buttonRecipe,
    },
  },
});

export const system = createSystem(defaultConfig, config);
