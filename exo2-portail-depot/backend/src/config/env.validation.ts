import { z } from 'zod';

/**
 * Validation de l'environnement AU DEMARRAGE.
 *
 * Pourquoi : une variable manquante ou mal formee doit faire echouer le boot
 * bruyamment, pas produire un bug silencieux trois heures plus tard (une
 * presigned URL signee sur le mauvais host, par exemple, echoue seulement
 * cote navigateur et est penible a diagnostiquer).
 */
export const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT_BACKEND: z.coerce.number().int().default(22409),
  /**
   * Interface d ecoute.
   *
   * 127.0.0.1 par defaut : en developpement le process tourne sur l hote, qui
   * est partage avec d autres candidats, et rien ne doit sortir de la machine.
   *
   * En conteneur, cette valeur DOIT etre 0.0.0.0, sans quoi le process n est
   * joignable que depuis son propre namespace reseau et nginx obtient un
   * "connection refused". Ce n est pas une exposition : le port n est pas
   * publie sur l hote, donc seul le reseau interne du compose y accede.
   */
  BIND_ADDRESS: z.string().default('127.0.0.1'),
  PUBLIC_BASE_URL: z.string().url(),

  DATABASE_URL: z.string().min(1),

  // Deux secrets distincts : un token de depot client ne doit jamais pouvoir
  // etre presente comme un token avocat.
  JWT_LAWYER_SECRET: z.string().min(16),
  JWT_LAWYER_TTL: z.string().default('8h'),
  JWT_DEPOSIT_SECRET: z.string().min(16),
  JWT_DEPOSIT_TTL: z.string().default('30m'),
  COOKIE_SECURE: z
    .string()
    .default('false')
    .transform((v) => v === 'true'),

  S3_ACCESS_KEY: z.string().min(1),
  S3_SECRET_KEY: z.string().min(1),
  S3_BUCKET: z.string().min(1),
  S3_REGION: z.string().default('us-east-1'),
  S3_INTERNAL_ENDPOINT: z.string().url(),
  // Endpoint SIGNE dans les presigned URLs : doit etre joignable par le
  // navigateur. Le distinguer de l'endpoint interne est le piege numero un
  // de ce montage.
  S3_PUBLIC_ENDPOINT: z.string().url(),

  DEPOSIT_LINK_TTL_DAYS: z.coerce.number().int().positive().default(7),
  PIN_MAX_ATTEMPTS: z.coerce.number().int().positive().default(5),
  PIN_LOCK_MINUTES: z.coerce.number().int().positive().default(15),
  UPLOAD_MAX_BYTES: z.coerce.number().int().positive().default(26_214_400),
  UPLOAD_MAX_FILES_PER_REQUEST: z.coerce.number().int().positive().default(10),
  PRESIGN_UPLOAD_TTL_SECONDS: z.coerce.number().int().positive().default(600),
  PRESIGN_DOWNLOAD_TTL_SECONDS: z.coerce.number().int().positive().default(60),
});

export type Env = z.infer<typeof envSchema>;

export function validateEnv(raw: Record<string, unknown>): Env {
  const result = envSchema.safeParse(raw);
  if (!result.success) {
    const details = result.error.issues
      .map((i) => `  - ${i.path.join('.')}: ${i.message}`)
      .join('\n');
    throw new Error(`Configuration d'environnement invalide :\n${details}`);
  }
  return result.data;
}
