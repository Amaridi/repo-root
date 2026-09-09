import type { NextFunction, Request, Response } from 'express';
import type { MetricsService } from './metrics.service';

/** Route de scrape : elle ne se mesure pas elle-meme. */
const METRICS_PATH = '/api/metrics';

/**
 * Valeur de repli quand aucune route n a ete appariee (404, sondes de scan).
 *
 * Sans ce repli, il faudrait etiqueter avec l URL demandee : un robot qui teste
 * mille chemins creerait mille series temporelles permanentes. C est la faute
 * classique de l instrumentation HTTP, et elle est irreversible : une serie
 * creee reste en memoire de Prometheus jusqu a expiration de la retention.
 */
const UNMATCHED = 'unmatched';

/**
 * Mesure de toutes les requetes HTTP.
 *
 * Middleware Express plutot qu intercepteur NestJS, deliberement :
 *
 *  - un intercepteur ne voit que les routes APPARIEES, donc aucun 404 ;
 *  - il ne voit pas non plus le statut final quand un filtre d exception le
 *    reecrit, alors qu ici on lit le code reellement envoye au client ;
 *  - `res.on('finish')` mesure la duree jusqu au dernier octet ecrit, ce qui est
 *    ce qu observe l utilisateur.
 *
 * Il est pose dans main.ts, avant l ecoute, donc avant tout garde et tout
 * pipe : rien ne lui echappe.
 */
export function createHttpMetricsMiddleware(metrics: MetricsService) {
  return function httpMetricsMiddleware(req: Request, res: Response, next: NextFunction): void {
    if (req.path === METRICS_PATH) {
      next();
      return;
    }

    const startedAt = process.hrtime.bigint();

    res.on('finish', () => {
      const durationSeconds = Number(process.hrtime.bigint() - startedAt) / 1e9;
      metrics.recordHttpRequest(req.method, resolveRouteLabel(req), res.statusCode, durationSeconds);
    });

    next();
  };
}

/**
 * Gabarit de la route appariee, jamais l URL reelle.
 *
 * `req.route` n est renseigne par Express qu APRES appariement, ce qui est
 * garanti au moment de `finish`. Le chemin est relatif au routeur qui a
 * apparie, d ou la concatenation avec `baseUrl`.
 */
function resolveRouteLabel(req: Request): string {
  const template: unknown = req.route?.path;
  if (typeof template !== 'string' || template.length === 0) return UNMATCHED;

  const full = `${req.baseUrl ?? ''}${template}`.replace(/\/{2,}/g, '/');
  return full.length > 1 && full.endsWith('/') ? full.slice(0, -1) : full;
}
