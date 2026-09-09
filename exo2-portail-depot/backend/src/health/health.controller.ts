import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Deux sondes distinctes, et cette distinction n'est pas cosmetique :
 *  - /health/live  : le process repond. Un orchestrateur qui echoue ici doit
 *                    REDEMARRER le conteneur.
 *  - /health/ready : les dependances sont joignables. Un echec ici doit
 *                    seulement RETIRER l'instance du trafic, pas la tuer —
 *                    redemarrer n'aiderait pas si c'est Postgres qui est bas.
 */
@ApiTags('health')
@Controller('health')
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  @Get('live')
  @ApiOperation({ summary: 'Le process repond' })
  live() {
    return { status: 'ok', uptimeSeconds: Math.floor(process.uptime()) };
  }

  @Get('ready')
  @ApiOperation({ summary: 'Les dependances sont joignables' })
  async ready() {
    const checks: Record<string, 'up' | 'down'> = {};

    try {
      await this.prisma.$queryRaw`SELECT 1`;
      checks.database = 'up';
    } catch {
      checks.database = 'down';
    }

    // Le stockage objet sera ajoute ici au bloc 6 (headBucket).

    const healthy = Object.values(checks).every((s) => s === 'up');
    if (!healthy) {
      throw new ServiceUnavailableException({ status: 'error', checks });
    }
    return { status: 'ok', checks };
  }
}
