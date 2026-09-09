import { Body, Controller, Get, HttpCode, HttpStatus, Post, Res, UseGuards } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiCookieAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { CookieOptions, Response } from 'express';
import type { Env } from '../config/env.validation';
import { AuthService } from './auth.service';
import { LAWYER_SESSION_COOKIE } from './auth.constants';
import type { AuthenticatedLawyer } from './auth.types';
import { CurrentLawyer } from './decorators/current-lawyer.decorator';
import { LoginDto } from './dto/login.dto';
import { JwtAuthGuard } from './guards/jwt-auth.guard';

/**
 * Le controleur ne contient AUCUNE logique metier : il traduit HTTP vers le
 * service, et pose ou retire le cookie. La verification des identifiants,
 * l'emission du token et la lecture du profil sont dans AuthService.
 */
@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Connexion avocat ; pose le cookie de session' })
  @ApiResponse({ status: 200, description: 'Connexion reussie' })
  @ApiResponse({ status: 401, description: 'Identifiants invalides' })
  async login(@Body() dto: LoginDto, @Res({ passthrough: true }) response: Response) {
    const session = await this.authService.login(dto.email, dto.password);

    response.cookie(LAWYER_SESSION_COOKIE, session.token, {
      ...this.cookieOptions(),
      expires: session.expiresAt,
    });

    // Le token n'est PAS renvoye dans le corps : le frontend n'a aucune raison
    // d'y avoir acces, et le lui donner reintroduirait le risque qu'il le
    // stocke dans localStorage.
    return { lawyer: session.lawyer, expiresAt: session.expiresAt };
  }

  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Deconnexion ; retire le cookie de session' })
  logout(@Res({ passthrough: true }) response: Response): void {
    // Les options doivent etre identiques a la pose, sinon le navigateur ne
    // reconnait pas le cookie a supprimer.
    response.clearCookie(LAWYER_SESSION_COOKIE, this.cookieOptions());
  }

  @Get('me')
  @UseGuards(JwtAuthGuard)
  @ApiCookieAuth()
  @ApiOperation({ summary: 'Profil de l avocat authentifie' })
  @ApiResponse({ status: 401, description: 'Session absente, invalide ou expiree' })
  me(@CurrentLawyer() lawyer: AuthenticatedLawyer) {
    return this.authService.getProfile(lawyer.id);
  }

  private cookieOptions(): CookieOptions {
    return {
      httpOnly: true, // inaccessible au JavaScript, donc a une XSS
      // Secure est pilote par l'environnement : impossible en HTTP local,
      // obligatoire derriere le proxy HTTPS.
      secure: this.config.get('COOKIE_SECURE', { infer: true }),
      // Strict est possible ici parce que le frontend et l'API partagent une
      // origine unique. Cela couvre le CSRF sans jeton anti-CSRF dedie.
      sameSite: 'strict',
      path: '/',
    };
  }
}
