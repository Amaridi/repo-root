import { describe, expect, it } from '@jest/globals';
import { createHash } from 'node:crypto';
import { ACCESS_TOKEN_PATTERN } from '../deposit-access/deposit-access.constants';
import {
  buildDepositUrl,
  generateAccessToken,
  generatePin,
  hashAccessToken,
} from './deposit-secrets';

/**
 * Secrets d acces au lien de depot.
 *
 * Ces fonctions sont la premiere ligne de defense du parcours client : le token
 * fait office de premier facteur, le PIN de second. Une faiblesse ici ne se
 * verrait dans aucun test fonctionnel — tout continuerait de « marcher ».
 */
describe('deposit-secrets', () => {
  describe('generateAccessToken', () => {
    it('produit exactement la forme attendue par le filtre de la couche publique', () => {
      // Le service refuse tout token qui ne satisfait pas ACCESS_TOKEN_PATTERN
      // avant meme d interroger la base. Si le generateur et le filtre
      // divergeaient, AUCUN lien ne serait ouvrable — panne totale et
      // silencieuse du parcours client. Les deux sont donc verifies ensemble.
      for (let i = 0; i < 200; i += 1) {
        const token = generateAccessToken();
        expect(token).toMatch(ACCESS_TOKEN_PATTERN);
        // 32 octets en base64url, sans remplissage : 43 caracteres.
        expect(token).toHaveLength(43);
      }
    });

    it('n emet jamais deux fois le meme token', () => {
      // 500 tirages sur 2^256 possibilites : une collision signalerait une
      // source d alea cassee, pas de la malchance.
      const tokens = new Set(Array.from({ length: 500 }, () => generateAccessToken()));
      expect(tokens.size).toBe(500);
    });

    it('reste utilisable tel quel dans une URL', () => {
      for (let i = 0; i < 100; i += 1) {
        const token = generateAccessToken();
        // base64url et non base64 : ni +, ni /, ni = a echapper.
        expect(token).not.toMatch(/[+/=]/);
        expect(encodeURIComponent(token)).toBe(token);
      }
    });
  });

  describe('hashAccessToken', () => {
    it('est un SHA-256 hexadecimal, deterministe', () => {
      const token = generateAccessToken();
      const expected = createHash('sha256').update(token).digest('hex');

      expect(hashAccessToken(token)).toBe(expected);
      expect(hashAccessToken(token)).toHaveLength(64);
      expect(hashAccessToken(token)).toMatch(/^[0-9a-f]{64}$/);
      // Deterministe : c est ce qui permet de retrouver la demande par
      // empreinte sans jamais stocker le token en clair.
      expect(hashAccessToken(token)).toBe(hashAccessToken(token));
    });

    it('ne laisse pas deviner le token', () => {
      const token = generateAccessToken();
      const hash = hashAccessToken(token);
      expect(hash).not.toContain(token);
      expect(hash).not.toBe(token);
    });

    it('donne des empreintes distinctes pour deux tokens distincts', () => {
      expect(hashAccessToken(generateAccessToken())).not.toBe(
        hashAccessToken(generateAccessToken()),
      );
    });
  });

  describe('generatePin', () => {
    it('produit toujours six chiffres', () => {
      for (let i = 0; i < 500; i += 1) {
        expect(generatePin()).toMatch(/^[0-9]{6}$/);
      }
    });

    it('conserve les zeros de tete', () => {
      // Sans padStart, 42 sortirait en "42" : un PIN a deux chiffres, soit
      // 100 combinaisons au lieu d un million. Le defaut serait invisible a
      // l usage et devastateur. Sur 20 000 tirages, la probabilite de ne voir
      // aucun PIN commencant par 0 est de 0.9^20000, soit nulle.
      const pins = Array.from({ length: 20_000 }, () => generatePin());
      expect(pins.every((pin) => pin.length === 6)).toBe(true);
      expect(pins.some((pin) => pin.startsWith('0'))).toBe(true);
      expect(pins.some((pin) => pin.startsWith('00'))).toBe(true);
    });

    it('couvre l ensemble de l espace des chiffres', () => {
      // Une source biaisee (un modulo mal fait, un alea tronque) se verrait ici
      // par l absence d un chiffre en tete ou en queue.
      const pins = Array.from({ length: 20_000 }, () => generatePin());
      const premiers = new Set(pins.map((pin) => pin[0]));
      const derniers = new Set(pins.map((pin) => pin[5]));
      expect(premiers.size).toBe(10);
      expect(derniers.size).toBe(10);
    });
  });

  describe('buildDepositUrl', () => {
    it('assemble le lien remis au client', () => {
      expect(buildDepositUrl('https://depot.example.com', 'JETON')).toBe(
        'https://depot.example.com/d/JETON',
      );
    });

    it('ne double jamais la barre oblique', () => {
      // PUBLIC_BASE_URL vient du .env : un slash final y est une faute de
      // frappe banale, elle ne doit pas produire une URL en //d/.
      expect(buildDepositUrl('https://depot.example.com/', 'JETON')).toBe(
        'https://depot.example.com/d/JETON',
      );
      expect(buildDepositUrl('https://depot.example.com///', 'JETON')).toBe(
        'https://depot.example.com/d/JETON',
      );
    });

    it('produit une URL que le navigateur analysera correctement', () => {
      const token = generateAccessToken();
      const url = new URL(buildDepositUrl('http://127.0.0.1:22470', token));
      expect(url.pathname).toBe(`/d/${token}`);
    });
  });
});
