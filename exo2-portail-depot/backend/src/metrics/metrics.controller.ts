import { Controller, Get, Header, Res } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import type { Response } from 'express';
import { MetricsService } from './metrics.service';

/**
 * GET /api/metrics — endpoint de scrape Prometheus.
 *
 * Non authentifie, deliberement : Prometheus scrape en HTTP simple, le backend
 * n ecoute que sur 127.0.0.1, et le proxy frontal refuse /api/metrics venant de
 * l exterieur (regle documentee dans infra/nginx/README.md). L exposition se
 * joue au niveau reseau, pas dans une garde applicative — un secret de scrape
 * en dur dans un fichier de configuration Prometheus n aurait ajoute aucune
 * securite reelle.
 *
 * Retire de la documentation OpenAPI : ce n est pas une route de l API metier,
 * et l afficher inviterait a l appeler depuis le navigateur.
 */
@ApiExcludeController()
@Controller('metrics')
export class MetricsController {
  constructor(private readonly metrics: MetricsService) {}

  @Get()
  // Une exposition de metriques ne doit jamais etre servie depuis un cache
  // intermediaire : un scrape lit un instant, pas un instantane conserve.
  @Header('Cache-Control', 'no-store')
  async scrape(@Res() response: Response): Promise<void> {
    const { body, contentType } = await this.metrics.scrape();
    response.type(contentType).send(body);
  }
}
