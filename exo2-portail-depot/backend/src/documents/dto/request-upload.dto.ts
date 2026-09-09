import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsInt, IsString, Length, Matches, Min } from 'class-validator';

/**
 * Aucun separateur de chemin, aucun caractere de controle.
 *
 * Le nom sert a l affichage et au Content-Disposition, jamais a construire la
 * cle de stockage — mais autant refuser l entree malveillante des le bord.
 * Motif construit depuis une chaine pour rester lisible en revue.
 */
const SAFE_FILENAME = new RegExp('^[^/\\\u0000-\u001f]+$');

export class RequestUploadDto {
  @ApiProperty({ example: 'avis-electricite-juillet.pdf' })
  @IsString()
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
  @Length(1, 255)
  @Matches(SAFE_FILENAME, { message: 'Le nom de fichier contient des caracteres interdits.' })
  filename!: string;

  @ApiProperty({ example: 'application/pdf' })
  @IsString()
  @Length(3, 120)
  mimeType!: string;

  @ApiProperty({ example: 248531, description: 'Taille annoncee, en octets' })
  @IsInt()
  @Min(1)
  sizeBytes!: number;
}
