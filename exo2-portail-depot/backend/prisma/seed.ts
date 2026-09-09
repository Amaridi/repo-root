import { PrismaClient } from '@prisma/client';
import * as argon2 from 'argon2';

/**
 * Cree le compte avocat de demonstration. Idempotent (upsert) : le seed peut
 * etre rejoue par install.sh sans dupliquer ni ecraser de donnees.
 *
 * Il n'y a pas d'inscription publique dans le produit : c'est ici que naissent
 * les comptes.
 */
const prisma = new PrismaClient();

async function main(): Promise<void> {
  const email = process.env.SEED_LAWYER_EMAIL;
  const password = process.env.SEED_LAWYER_PASSWORD;
  const displayName = process.env.SEED_LAWYER_NAME ?? 'Avocat';

  if (!email || !password) {
    throw new Error('SEED_LAWYER_EMAIL et SEED_LAWYER_PASSWORD sont requis.');
  }

  const passwordHash = await argon2.hash(password, { type: argon2.argon2id });

  const lawyer = await prisma.lawyer.upsert({
    where: { email },
    update: { displayName },
    create: { email, passwordHash, displayName },
  });

  console.log(`[seed] avocat pret : ${lawyer.email} (${lawyer.displayName})`);
}

main()
  .catch((error: unknown) => {
    console.error('[seed] echec :', error);
    process.exit(1);
  })
  .finally(() => void prisma.$disconnect());
