import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsEmail, IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class LoginDto {
  @ApiProperty({ example: 'avocat@div-protocol.test' })
  @IsEmail({}, { message: "L'adresse electronique est invalide." })
  // Normalisation a l'entree : l'unicite en base est sensible a la casse, une
  // adresse saisie avec une majuscule ne doit pas empecher la connexion.
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().toLowerCase() : value,
  )
  email!: string;

  @ApiProperty({ example: '••••••••' })
  @IsString()
  @IsNotEmpty({ message: 'Le mot de passe est requis.' })
  // Borne haute : argon2 est volontairement couteux, une entree de plusieurs
  // megaoctets serait un vecteur de deni de service applicatif.
  @MaxLength(256)
  password!: string;
}
