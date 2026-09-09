import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import type { Env } from '../config/env.validation';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { LAWYER_TOKEN_AUDIENCE } from './auth.constants';
import { JwtAuthGuard } from './guards/jwt-auth.guard';

@Module({
  imports: [
    // registerAsync : le secret vient de la configuration validee au boot, il
    // n'est jamais code en dur ni lu depuis process.env a la volee.
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) => ({
        secret: config.get('JWT_LAWYER_SECRET', { infer: true }),
        signOptions: {
          expiresIn: config.get('JWT_LAWYER_TTL', { infer: true }),
          audience: LAWYER_TOKEN_AUDIENCE,
        },
      }),
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService, JwtAuthGuard],
  // JwtAuthGuard et JwtModule sont exportes pour que les modules a venir
  // (DepositRequestsModule, DocumentsModule) protegent leurs routes sans
  // redeclarer la configuration JWT.
  exports: [AuthService, JwtAuthGuard, JwtModule],
})
export class AuthModule {}
