import { ApiProperty } from '@nestjs/swagger';
import type { Document } from '@prisma/client';

/**
 * Vue d un document. La cle de stockage n est JAMAIS exposee : elle est un
 * detail d implementation du bucket, et la connaitre n apporte rien puisque le
 * bucket est prive.
 */
export class DocumentView {
  @ApiProperty() id!: string;
  @ApiProperty() originalName!: string;
  @ApiProperty() mimeType!: string;
  @ApiProperty({ description: 'Taille reelle constatee cote stockage' })
  sizeBytes!: number;
  @ApiProperty({ enum: ['PENDING', 'AVAILABLE'] }) status!: string;
  @ApiProperty({ nullable: true }) confirmedAt!: Date | null;
  @ApiProperty() createdAt!: Date;
}

export class UploadTicketView {
  @ApiProperty() documentId!: string;

  @ApiProperty({ description: 'URL de depot signee, a utiliser en PUT' })
  uploadUrl!: string;

  @ApiProperty({
    description: 'En-tetes obligatoires du PUT : le Content-Type est signe',
  })
  requiredHeaders!: Record<string, string>;

  @ApiProperty() expiresAt!: Date;
}

export function toDocumentView(entity: Document): DocumentView {
  return {
    id: entity.id,
    originalName: entity.originalName,
    mimeType: entity.mimeType,
    // BigInt en base (un fichier peut depasser 2 Go a terme), Number en sortie :
    // JSON ne sait pas serialiser un BigInt.
    sizeBytes: Number(entity.sizeBytes),
    status: entity.status,
    confirmedAt: entity.confirmedAt,
    createdAt: entity.createdAt,
  };
}
