import type { ObjectStat, StorageService } from '../storage/storage.service';

/**
 * Faux stockage objet, en memoire.
 *
 * MinIO ne peut pas etre dans un test unitaire, mais le COMPORTEMENT qui compte
 * peut l etre : un objet est present ou absent, et il a une taille et un type
 * REELS, qui peuvent differer de ce que le client avait annonce. C est
 * exactement le cas que la confirmation doit attraper — il a ete constate en
 * conditions reelles, une URL presignee en PUT n imposant pas les en-tetes.
 *
 * `put()` est l equivalent du transfert direct navigateur vers MinIO : le test
 * peut donc simuler un client honnete, un client menteur, ou un client qui
 * n envoie rien du tout.
 */
export function createFakeStorage() {
  const objects = new Map<string, ObjectStat>();
  const removed: string[] = [];

  const service = {
    createUploadUrl: async (key: string, contentType: string) => ({
      url: `https://stockage.test/depot-documents/${key}?signature=factice&type=${encodeURIComponent(contentType)}`,
      expiresAt: new Date(Date.now() + 600_000),
    }),

    createDownloadUrl: async (key: string, originalName: string) =>
      `https://stockage.test/depot-documents/${key}?signature=factice&nom=${encodeURIComponent(originalName)}`,

    statObject: async (key: string): Promise<ObjectStat | null> => objects.get(key) ?? null,

    removeObject: async (key: string) => {
      objects.delete(key);
      removed.push(key);
    },

    isReachable: async () => true,
  };

  return {
    storage: service as unknown as StorageService,
    /** Depose un objet, tel que le ferait le navigateur. */
    put(key: string, sizeBytes: number, contentType: string | undefined) {
      objects.set(key, { sizeBytes, etag: '"factice"', contentType });
    },
    objects,
    /** Cles reellement supprimees du stockage : un rejet doit nettoyer. */
    removed,
  };
}
