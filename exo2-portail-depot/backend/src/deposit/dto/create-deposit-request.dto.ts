import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsEmail, IsInt, IsOptional, IsString, Length, Max, MaxLength, Min } from 'class-validator';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

export class CreateDepositRequestDto {
  @ApiProperty({ example: 'Pieces pour la succession Martin' })
  @IsString()
  @Transform(trim)
  @Length(3, 200)
  title!: string;

  @ApiPropertyOptional({
    example: "Merci de transmettre l'acte de deces et le livret de famille.",
  })
  @IsOptional()
  @IsString()
  @Transform(trim)
  @MaxLength(2000)
  instructions?: string;

  @ApiProperty({ example: 'Jeanne Martin' })
  @IsString()
  @Transform(trim)
  @Length(2, 120)
  clientName!: string;

  @ApiPropertyOptional({ example: 'jeanne.martin@example.com' })
  @IsOptional()
  @IsEmail({}, { message: "L'adresse electronique du client est invalide." })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().toLowerCase() : value,
  )
  clientEmail?: string;

  @ApiPropertyOptional({
    example: 7,
    description: 'Duree de validite du lien, en jours. Par defaut : DEPOSIT_LINK_TTL_DAYS.',
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  // Borne haute : un lien de depot est un secret transmis par courriel ou par
  // telephone. Le laisser valide un an serait un choix de securite, pas un
  // confort d'interface.
  @Max(90)
  expiresInDays?: number;
}
