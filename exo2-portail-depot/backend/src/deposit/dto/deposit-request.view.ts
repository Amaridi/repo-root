import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import type { DepositRequest, DepositRequestStatus } from '@prisma/client';

/**
 * Representations renvoyees par l'API.
 *
 * Le mapping est EXPLICITE et centralise ici : aucune entite Prisma n'est
 * serialisee directement. C'est ce qui garantit que tokenHash et pinHash ne
 * peuvent pas fuiter par l'ajout distrait d'un champ au schema.
 */

export class DepositRequestView {
  @ApiProperty() id!: string;
  @ApiProperty() title!: string;
  @ApiPropertyOptional({ nullable: true }) instructions!: string | null;
  @ApiProperty() clientName!: string;
  @ApiPropertyOptional({ nullable: true }) clientEmail!: string | null;
  @ApiProperty({ enum: ['PENDING', 'IN_PROGRESS', 'SUBMITTED', 'CLOSED'] })
  status!: DepositRequestStatus;
  @ApiProperty() expiresAt!: Date;

  /**
   * Calcule, jamais persiste : un booleen en base mentirait des qu'une horloge
   * derive ou qu'une tache planifiee ne tourne pas.
   */
  @ApiProperty() isExpired!: boolean;

  @ApiPropertyOptional({ nullable: true }) submittedAt!: Date | null;
  @ApiProperty() createdAt!: Date;
  @ApiProperty({ description: 'Nombre de documents effectivement deposes' })
  documentsCount!: number;
}

/**
 * Reponse de creation.
 *
 * Le lien complet et le PIN en clair n'apparaissent QUE dans cette reponse,
 * une seule fois : la base ne conserve que leurs empreintes, ils sont donc
 * irrecuperables ensuite. L'interface devra le dire clairement a l'avocat.
 */
export class CreatedDepositRequestView {
  @ApiProperty({ type: DepositRequestView })
  request!: DepositRequestView;

  @ApiProperty({
    description: 'Secrets affiches une seule fois, non recuperables ensuite',
  })
  access!: {
    depositUrl: string;
    pin: string;
  };
}

type WithDocumentCount = DepositRequest & { _count?: { documents: number } };

export function toDepositRequestView(
  entity: WithDocumentCount,
  now: Date = new Date(),
): DepositRequestView {
  return {
    id: entity.id,
    title: entity.title,
    instructions: entity.instructions,
    clientName: entity.clientName,
    clientEmail: entity.clientEmail,
    status: entity.status,
    expiresAt: entity.expiresAt,
    isExpired: entity.expiresAt.getTime() <= now.getTime(),
    submittedAt: entity.submittedAt,
    createdAt: entity.createdAt,
    documentsCount: entity._count?.documents ?? 0,
  };
}
