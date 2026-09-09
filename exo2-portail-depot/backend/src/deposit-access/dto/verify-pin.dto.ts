import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsString, Matches } from 'class-validator';

export class VerifyPinDto {
  @ApiProperty({ example: '025464', description: 'PIN a 6 chiffres' })
  @IsString()
  // Les espaces sont retires : un PIN copie-colle depuis un courriel en
  // contient souvent.
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.replace(/\s/g, '') : value,
  )
  @Matches(/^\d{6}$/, { message: 'Le code doit comporter 6 chiffres.' })
  pin!: string;
}
