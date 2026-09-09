import { Body, Controller, Get, Param, ParseUUIDPipe, Post, UseGuards } from '@nestjs/common';
import { ApiCookieAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { AuthenticatedLawyer } from '../auth/auth.types';
import { CurrentLawyer } from '../auth/decorators/current-lawyer.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { DepositService } from './deposit.service';
import { CreateDepositRequestDto } from './dto/create-deposit-request.dto';
import { CreatedDepositRequestView, DepositRequestView } from './dto/deposit-request.view';

/**
 * Espace avocat authentifie.
 *
 * La garde est posee sur le CONTROLEUR entier et non route par route : le
 * defaut devient "protege", et une route ajoutee plus tard ne peut pas etre
 * publique par oubli.
 */
@ApiTags('deposits')
@ApiCookieAuth()
@UseGuards(JwtAuthGuard)
@Controller('deposits')
export class DepositController {
  constructor(private readonly depositService: DepositService) {}

  @Post()
  @ApiOperation({ summary: 'Creer une demande de depot' })
  @ApiResponse({ status: 201, type: CreatedDepositRequestView })
  @ApiResponse({ status: 401, description: 'Non authentifie' })
  create(
    @CurrentLawyer() lawyer: AuthenticatedLawyer,
    @Body() dto: CreateDepositRequestDto,
  ): Promise<CreatedDepositRequestView> {
    return this.depositService.create(lawyer.id, dto);
  }

  @Get()
  @ApiOperation({ summary: 'Lister ses propres demandes' })
  @ApiResponse({ status: 200, type: [DepositRequestView] })
  findAll(@CurrentLawyer() lawyer: AuthenticatedLawyer): Promise<DepositRequestView[]> {
    return this.depositService.findAllForLawyer(lawyer.id);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Detail d une de ses demandes' })
  @ApiResponse({ status: 200, type: DepositRequestView })
  @ApiResponse({ status: 404, description: 'Inexistante ou appartenant a un autre avocat' })
  findOne(
    @CurrentLawyer() lawyer: AuthenticatedLawyer,
    // ParseUUIDPipe : un identifiant malforme est une erreur 400 immediate,
    // il n'atteint jamais la base.
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<DepositRequestView> {
    return this.depositService.findOneForLawyer(lawyer.id, id);
  }
}
