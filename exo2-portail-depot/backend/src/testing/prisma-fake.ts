import type { Document, DepositRequest, Lawyer } from '@prisma/client';
import type { PrismaService } from '../prisma/prisma.service';

/**
 * Faux client Prisma en memoire, qui APPLIQUE reellement les clauses `where`.
 *
 * Pourquoi ce travail plutot qu un simple `jest.fn(async () => null)` :
 *
 * Un test d isolation dont le mock renvoie `null` quoi qu on lui passe ne
 * prouve RIEN. Il passerait meme si le service oubliait completement le filtre
 * `lawyerId` — c est exactement le piege dans lequel une verification
 * precedente de ce projet est tombee (un 404 obtenu parce que le second avocat
 * n existait pas, pas parce que le filtre fonctionnait).
 *
 * Ici le magasin contient les donnees des DEUX avocats, et le filtre est
 * evalue : si `where` perd son `lawyerId`, la demande de l autre avocat est
 * retournee et le test echoue. C est la difference entre verifier une intention
 * et verifier un comportement.
 *
 * Le perimetre est volontairement limite aux operations reellement employees
 * par les services. Ce n est pas une reimplementation de Prisma, c est un
 * double de test.
 */

type Row = Record<string, unknown>;

/** Condition sur un champ : egalite stricte, ou `{ in: [...] }`. */
function fieldMatches(value: unknown, condition: unknown): boolean {
  if (condition !== null && typeof condition === 'object' && 'in' in condition) {
    const { in: allowed } = condition as { in: unknown[] };
    return allowed.includes(value);
  }
  return value === condition;
}

/** Toutes les conditions du `where` doivent etre satisfaites. */
function matches(row: Row, where: Row | undefined): boolean {
  if (!where) return true;
  return Object.entries(where).every(([key, condition]) => fieldMatches(row[key], condition));
}

/** Applique un `select` Prisma : seules les cles a true sortent. */
function project(row: Row, select?: Record<string, boolean>): Row {
  if (!select) return { ...row };
  const out: Row = {};
  for (const [key, wanted] of Object.entries(select)) {
    if (wanted) out[key] = row[key];
  }
  return out;
}

export interface FakeStore {
  lawyers: Lawyer[];
  requests: DepositRequest[];
  documents: Document[];
}

export interface FakePrisma {
  prisma: PrismaService;
  store: FakeStore;
  /** Compte des appels, pour verifier qu une requete n a PAS eu lieu. */
  calls: { depositRequestFindUnique: number; documentCreate: number };
}

export function createFakePrisma(initial: Partial<FakeStore> = {}): FakePrisma {
  const store: FakeStore = {
    lawyers: initial.lawyers ?? [],
    requests: initial.requests ?? [],
    documents: initial.documents ?? [],
  };

  const calls = { depositRequestFindUnique: 0, documentCreate: 0 };

  function collection(name: 'lawyers' | 'requests' | 'documents'): Row[] {
    return store[name] as unknown as Row[];
  }

  /** Fabrique les operations communes a une collection. */
  function delegate(name: 'lawyers' | 'requests' | 'documents', onFindUnique?: () => void) {
    const rows = () => collection(name);

    const findFirst = async (args: {
      where?: Row;
      select?: Record<string, boolean>;
      include?: Row;
    }) => {
      const found = rows().find((row) => matches(row, args?.where));
      if (!found) return null;
      return withInclude(project(found, args?.select), found, args?.include);
    };

    return {
      findUnique: async (args: { where?: Row; select?: Record<string, boolean> }) => {
        onFindUnique?.();
        return findFirst(args);
      },
      findUniqueOrThrow: async (args: { where?: Row; select?: Record<string, boolean> }) => {
        const found = await findFirst(args);
        if (!found) throw new Error(`${name}: aucune ligne ne correspond`);
        return found;
      },
      findFirst,
      findMany: async (args?: { where?: Row; include?: Row }) => {
        return rows()
          .filter((row) => matches(row, args?.where))
          .map((row) => withInclude({ ...row }, row, args?.include));
      },
      count: async (args?: { where?: Row }) =>
        rows().filter((row) => matches(row, args?.where)).length,
      create: async (args: { data: Row }) => {
        const row = { ...defaults(name), ...args.data };
        rows().push(row);
        if (name === 'documents') calls.documentCreate += 1;
        return { ...row };
      },
      update: async (args: { where: Row; data: Row }) => {
        const found = rows().find((row) => matches(row, args.where));
        if (!found) throw new Error(`${name}: ligne introuvable pour update`);
        Object.assign(found, args.data);
        return { ...found };
      },
      updateMany: async (args: { where?: Row; data: Row }) => {
        const targets = rows().filter((row) => matches(row, args?.where));
        for (const row of targets) Object.assign(row, args.data);
        return { count: targets.length };
      },
      delete: async (args: { where: Row }) => {
        const index = rows().findIndex((row) => matches(row, args.where));
        if (index < 0) throw new Error(`${name}: ligne introuvable pour delete`);
        const [removed] = rows().splice(index, 1);
        return removed;
      },
    };
  }

  /** Seul `include` reellement utilise par les services : le compte de documents. */
  function withInclude(projected: Row, source: Row, include?: Row): Row {
    if (include && '_count' in include) {
      projected._count = {
        documents: store.documents.filter((d) => d.requestId === source.id).length,
      };
    }
    return projected;
  }

  const prisma = {
    lawyer: delegate('lawyers'),
    depositRequest: delegate('requests', () => {
      calls.depositRequestFindUnique += 1;
    }),
    document: delegate('documents'),
    // Les methodes du double renvoient deja des promesses : les executer en
    // parallele reproduit fidelement l usage fait dans le service.
    $transaction: async (operations: Promise<unknown>[]) => Promise.all(operations),
  } as unknown as PrismaService;

  return { prisma, store, calls };
}

/** Valeurs par defaut du schema, appliquees a la creation comme le ferait la base. */
function defaults(name: 'lawyers' | 'requests' | 'documents'): Row {
  const now = new Date();
  if (name === 'requests') {
    return {
      status: 'PENDING',
      instructions: null,
      clientEmail: null,
      failedAttempts: 0,
      lockedUntil: null,
      submittedAt: null,
      createdAt: now,
      updatedAt: now,
    };
  }
  if (name === 'documents') {
    return { status: 'PENDING', confirmedAt: null, createdAt: now, updatedAt: now };
  }
  return { createdAt: now, updatedAt: now };
}
