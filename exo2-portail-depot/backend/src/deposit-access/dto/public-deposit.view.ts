import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * Ce que voit le client AVANT d'avoir saisi le PIN.
 *
 * Strictement des metadonnees d'affichage. Aucun document, aucun identifiant
 * technique, aucune donnee sur l'avocat au-dela de son nom d'affichage, et
 * surtout jamais l'identifiant Prisma de la demande : le token public est le
 * seul designateur expose.
 *
 * Le compromis assume : detenir le token revele le nom de l'avocat et l'objet
 * de la demande. C'est le prix d'un ecran d'accueil comprehensible — sans lui,
 * le client saisirait un code sans savoir de quoi il s'agit.
 */
export class PublicDepositView {
  @ApiProperty() title!: string;
  @ApiPropertyOptional({ nullable: true }) instructions!: string | null;
  @ApiProperty() lawyerName!: string;
  @ApiProperty() clientName!: string;
  @ApiProperty() expiresAt!: Date;
}

/** Ce que voit le client APRES validation du PIN. */
export class DepositSessionView extends PublicDepositView {
  @ApiProperty({ enum: ['PENDING', 'IN_PROGRESS'] })
  status!: string;

  @ApiProperty({ description: 'Documents deja deposes' })
  documentsCount!: number;

  @ApiProperty({ description: 'Fin de validite de la session de depot' })
  sessionExpiresAt!: Date;
}
