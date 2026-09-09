import { describe, expect, it } from '@jest/globals';
import {
  buildStorageKey,
  extensionOf,
  slugifyFilename,
  validateDeclaredFile,
} from './document-rules';

const MAX = 25 * 1024 * 1024;

/**
 * Recevabilite d un fichier et fabrication des cles de stockage.
 *
 * Deux risques distincts sont couverts ici :
 *  - laisser entrer un type de fichier non voulu ;
 *  - laisser un nom fourni par le client influencer la cle de stockage, donc
 *    l emplacement d ecriture dans le bucket.
 */
describe('document-rules', () => {
  describe('validateDeclaredFile', () => {
    it('accepte les formats attendus dans un dossier juridique', () => {
      const acceptes: [string, string][] = [
        ['avis.pdf', 'application/pdf'],
        ['scan.JPG', 'image/jpeg'],
        ['photo.jpeg', 'image/jpeg'],
        ['capture.png', 'image/png'],
        ['piece.webp', 'image/webp'],
        ['fax.tiff', 'image/tiff'],
        ['note.txt', 'text/plain'],
        ['courrier.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
        ['compte.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],
        ['acte.odt', 'application/vnd.oasis.opendocument.text'],
      ];

      for (const [filename, mimeType] of acceptes) {
        expect(validateDeclaredFile(filename, mimeType, 1024, MAX)).toBeNull();
      }
    });

    it('refuse un type absent de la liste blanche', () => {
      // Le point de la liste blanche : un format inconnu est refuse par defaut,
      // sans avoir a le prevoir. Une liste noire serait toujours en retard.
      for (const mimeType of [
        'application/zip',
        'application/x-msdownload',
        'application/octet-stream',
        'text/html',
        'image/svg+xml',
        'application/x-sh',
      ]) {
        expect(validateDeclaredFile('charge.utile', mimeType, 1024, MAX)).toEqual({
          reason: 'MIME_NOT_ALLOWED',
          detail: expect.stringContaining(mimeType),
        });
      }
    });

    it('exige la coherence entre extension et type annonce', () => {
      // C est le controle qui supprime le cas « executable annonce en PDF » :
      // les deux valeurs viennent du client, mais il doit mentir deux fois de
      // facon coherente, et le type reel est de toute facon revarifie cote
      // stockage a la confirmation.
      expect(validateDeclaredFile('charge.exe', 'application/pdf', 1024, MAX)).toEqual({
        reason: 'EXTENSION_MISMATCH',
        detail: expect.stringContaining('.exe'),
      });
      expect(validateDeclaredFile('image.png', 'application/pdf', 1024, MAX)?.reason).toBe(
        'EXTENSION_MISMATCH',
      );
    });

    it('refuse un fichier sans extension', () => {
      const rejet = validateDeclaredFile('sans-extension', 'application/pdf', 1024, MAX);
      expect(rejet?.reason).toBe('EXTENSION_MISMATCH');
      expect(rejet?.detail).toContain('(absente)');
    });

    it('refuse un fichier vide', () => {
      expect(validateDeclaredFile('vide.pdf', 'application/pdf', 0, MAX)?.reason).toBe('EMPTY');
      expect(validateDeclaredFile('negatif.pdf', 'application/pdf', -1, MAX)?.reason).toBe('EMPTY');
    });

    it('refuse un fichier trop volumineux, et accepte la borne exacte', () => {
      expect(validateDeclaredFile('gros.pdf', 'application/pdf', MAX + 1, MAX)?.reason).toBe(
        'TOO_LARGE',
      );
      // La borne est inclusive : un fichier de exactement 25 Mo passe.
      expect(validateDeclaredFile('limite.pdf', 'application/pdf', MAX, MAX)).toBeNull();
    });

    it('refuse proprement un type qui porte le nom d une propriete d Object', () => {
      // BUG TROUVE PAR CE TEST. `ALLOWED_TYPES[mimeType]` sur un objet litteral
      // consulte aussi la CHAINE DE PROTOTYPES : avec mimeType valant
      // 'constructor', 'toString' ou '__proto__', la recherche renvoie une
      // fonction au lieu de undefined. Le garde `if (!allowedExtensions)` ne
      // declenche donc pas, et l appel suivant a `.includes()` levait une
      // TypeError non capturee — soit une reponse 500 la ou un 400 est attendu,
      // depuis une valeur entierement controlee par le client (le DTO accepte
      // n importe quelle chaine de 3 a 120 caracteres).
      for (const mimeType of [
        'constructor',
        'toString',
        '__proto__',
        'valueOf',
        'hasOwnProperty',
        'propertyIsEnumerable',
      ]) {
        expect(validateDeclaredFile('avis.pdf', mimeType, 1024, MAX)).toEqual({
          reason: 'MIME_NOT_ALLOWED',
          detail: expect.stringContaining(mimeType),
        });
      }
    });

    it('verifie le type avant la taille', () => {
      // L ordre compte pour le message rendu au client : dire « trop gros » d un
      // fichier de toute facon interdit enverrait l utilisateur compresser un
      // .zip qui ne sera jamais accepte.
      expect(validateDeclaredFile('gros.zip', 'application/zip', MAX * 10, MAX)?.reason).toBe(
        'MIME_NOT_ALLOWED',
      );
    });
  });

  describe('extensionOf', () => {
    it('extrait l extension en minuscules', () => {
      expect(extensionOf('avis.PDF')).toBe('pdf');
      expect(extensionOf('archive.tar.gz')).toBe('gz');
    });

    it('renvoie une chaine vide quand il n y a pas d extension exploitable', () => {
      expect(extensionOf('sans-point')).toBe('');
      // Un fichier cache facon Unix n a pas d extension, il a un nom.
      expect(extensionOf('.gitignore')).toBe('');
      // Point final : rien apres, donc rien a extraire.
      expect(extensionOf('finit-par-un-point.')).toBe('');
    });
  });

  describe('slugifyFilename', () => {
    it('neutralise toute tentative de traversee de chemin', () => {
      // Le risque concret : influencer l emplacement d ecriture dans le bucket.
      // Apres normalisation, aucun separateur ni segment relatif ne subsiste.
      for (const hostile of [
        '../../etc/passwd.txt',
        '..\\..\\windows\\system32\\config.txt',
        '/absolu/chemin.txt',
        './relatif.txt',
      ]) {
        const slug = slugifyFilename(hostile);
        expect(slug).not.toContain('/');
        expect(slug).not.toContain('\\');
        expect(slug).not.toContain('..');
      }
    });

    it('conserve l extension et normalise le reste', () => {
      expect(slugifyFilename('Avis d Échéance (juillet).pdf')).toBe('avis-d-echeance-juillet.pdf');
      // L extension est normalisee en minuscules elle aussi : deux depots du
      // meme fichier en .PDF et .pdf produisent des cles coherentes.
      expect(slugifyFilename('Releve 2026.PDF')).toBe('releve-2026.pdf');
    });

    it('ne produit jamais un nom vide', () => {
      // Un nom entierement compose de caracteres non retenus donnerait une cle
      // se terminant par un slash, donc un objet inatteignable.
      expect(slugifyFilename('???.pdf')).toBe('document.pdf');
      expect(slugifyFilename('中文文件.pdf')).toBe('document.pdf');
      expect(slugifyFilename('---.pdf')).toBe('document.pdf');
    });

    it('borne la longueur', () => {
      const slug = slugifyFilename(`${'a'.repeat(500)}.pdf`);
      expect(slug).toBe(`${'a'.repeat(80)}.pdf`);
    });

    it('ne conserve aucun caractere de controle', () => {
      // Construit depuis un code de caractere : un octet de controle ecrit en
      // clair dans un fichier source ne survit pas a une copie ou a un editeur.
      const avecControle = `nom${String.fromCharCode(7)}avec${String.fromCharCode(0)}controle.pdf`;
      expect(slugifyFilename(avecControle)).toBe('nom-avec-controle.pdf');
    });
  });

  describe('buildStorageKey', () => {
    it('prefixe par la demande et intercale un identifiant unique', () => {
      const { documentId, storageKey } = buildStorageKey('req-1', 'Avis d Échéance.pdf');
      expect(storageKey).toBe(`deposits/req-1/${documentId}/avis-d-echeance.pdf`);
    });

    it('ne collisionne pas sur deux depots du meme nom', () => {
      // Sans l identifiant de document, deposer deux fois « avis.pdf » ecraserait
      // silencieusement la premiere piece.
      const a = buildStorageKey('req-1', 'avis.pdf');
      const b = buildStorageKey('req-1', 'avis.pdf');
      expect(a.documentId).not.toBe(b.documentId);
      expect(a.storageKey).not.toBe(b.storageKey);
    });

    it('ne laisse pas un nom hostile sortir du prefixe de la demande', () => {
      const { storageKey } = buildStorageKey('req-1', '../../autre-demande/vol.pdf');
      expect(storageKey.startsWith('deposits/req-1/')).toBe(true);
      // Trois separateurs exactement : deposits / demande / document / nom.
      expect(storageKey.split('/')).toHaveLength(4);
    });
  });
});
