import { Injectable } from '@nestjs/common';
import { Counter, Histogram, Registry, collectDefaultMetrics } from 'prom-client';
import { METRIC, type PinOutcome, type UploadOutcome } from './metrics.constants';

/**
 * Instrumentation de l application.
 *
 * `prom-client` est utilise DIRECTEMENT, sans le module NestJS communement
 * employe pour l envelopper (`@willsoto/nestjs-prometheus`) : ce paquet est
 * publie en CommonJS et fait un `require` de `@nestjs/common`, qui est en ESM
 * pur depuis NestJS 12. Sous Jest en mode ESM et sous Node 22, ce `require`
 * echoue et rend intestable tout fichier qui l importe transitivement — ce qui
 * incluait le service de depot. Le contournement aurait ete un transform Babel
 * supplementaire ; la suppression de la dependance coute vingt lignes et retire
 * le probleme au lieu de le masquer.
 *
 * Un registre DEDIE plutot que le registre global : deux instanciations du
 * service (rechargement a chaud, tests) ne se disputent alors pas les noms de
 * metriques, alors que le registre global leve sur un doublon.
 *
 * Les services metier declarent un EVENEMENT ("un PIN a echoue"), pas une
 * ecriture de serie temporelle : les noms de metriques et les valeurs de labels
 * restent enfermes ici, et les labels sont types de facon fermee, donc la
 * cardinalite est bornee par le compilateur et non par la discipline.
 */
@Injectable()
export class MetricsService {
  readonly registry = new Registry();

  private readonly httpRequests: Counter<'method' | 'route' | 'status'>;
  private readonly httpDuration: Histogram<'method' | 'route'>;
  private readonly depositRequestsCreated: Counter<string>;
  private readonly depositSubmissions: Counter<string>;
  private readonly pinVerifications: Counter<'outcome'>;
  private readonly documentUploads: Counter<'outcome'>;

  constructor() {
    this.registry.setDefaultLabels({ app: 'depot-backend' });

    // Metriques de processus : memoire, event loop, CPU, uptime. Gratuites, et
    // `process_start_time_seconds` est ce qui permet de distinguer un service
    // lent d un service qui redemarre en boucle.
    collectDefaultMetrics({ register: this.registry });

    this.httpRequests = new Counter({
      name: METRIC.HTTP_REQUESTS,
      help: 'Nombre de requetes HTTP terminees, par methode, gabarit de route et statut.',
      // `route` est le GABARIT (/api/public/deposits/:token), jamais l URL
      // reelle : un token dans un label creerait une serie temporelle par
      // demande de depot, ferait exploser Prometheus, et divulguerait le secret
      // a quiconque lit /api/metrics.
      labelNames: ['method', 'route', 'status'],
      registers: [this.registry],
    });

    this.httpDuration = new Histogram({
      name: METRIC.HTTP_DURATION,
      help: 'Duree des requetes HTTP en secondes.',
      // Pas de label `status` ici : le croiser avec les buckets multiplierait
      // les series pour un interet quasi nul.
      labelNames: ['method', 'route'],
      // Bornes choisies pour CE service : une lecture en base est sous 100 ms,
      // une signature presignee autour de 10 ms, un argon2.verify autour de
      // 100 ms, et tout ce qui depasse la seconde est anormal.
      buckets: [0.01, 0.05, 0.1, 0.25, 0.5, 1, 3, 10],
      registers: [this.registry],
    });

    this.depositRequestsCreated = new Counter({
      name: METRIC.DEPOSIT_REQUESTS_CREATED,
      help: 'Demandes de depot creees par un avocat.',
      registers: [this.registry],
    });

    this.depositSubmissions = new Counter({
      name: METRIC.DEPOSIT_SUBMISSIONS,
      help: 'Depots soumis definitivement par un client.',
      registers: [this.registry],
    });

    this.pinVerifications = new Counter({
      name: METRIC.PIN_VERIFICATIONS,
      help: 'Verifications de code PIN, par issue (success, invalid, locked).',
      labelNames: ['outcome'],
      registers: [this.registry],
    });

    this.documentUploads = new Counter({
      name: METRIC.DOCUMENT_UPLOADS,
      help: 'Confirmations de depot de fichier, par issue (confirmed, rejected, failed).',
      labelNames: ['outcome'],
      registers: [this.registry],
    });
  }

  /**
   * Une requete HTTP terminee. Appele par le middleware, jamais par un service.
   */
  recordHttpRequest(method: string, route: string, status: number, durationSeconds: number): void {
    this.httpRequests.inc({ method, route, status: String(status) });
    this.httpDuration.observe({ method, route }, durationSeconds);
  }

  depositRequestCreated(): void {
    this.depositRequestsCreated.inc();
  }

  depositSubmitted(): void {
    this.depositSubmissions.inc();
  }

  pinVerified(outcome: PinOutcome): void {
    this.pinVerifications.inc({ outcome });
  }

  documentUpload(outcome: UploadOutcome): void {
    this.documentUploads.inc({ outcome });
  }

  /** Exposition au format texte Prometheus. */
  async scrape(): Promise<{ body: string; contentType: string }> {
    return { body: await this.registry.metrics(), contentType: this.registry.contentType };
  }
}
