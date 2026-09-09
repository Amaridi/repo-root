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

}
