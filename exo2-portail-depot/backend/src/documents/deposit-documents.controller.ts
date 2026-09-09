import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { DepositSession } from '../deposit-access/deposit-access.types';
import { CurrentDeposit } from '../deposit-access/decorators/current-deposit.decorator';
import { DepositSessionGuard } from '../deposit-access/guards/deposit-session.guard';
import { DocumentsService } from './documents.service';
import { DocumentView, UploadTicketView } from './dto/document.view';
import { RequestUploadDto } from './dto/request-upload.dto';

/**
 * Depot cote CLIENT, apres validation du PIN.
 *
 * Aucune route ne prend d identifiant de demande : il vient exclusivement de la
 * session. Le client ne peut donc, par construction, deposer ou lister que dans
 * sa propre demande — il n a aucun moyen d en designer une autre.
 */
@ApiTags('public')
@UseGuards(DepositSessionGuard)
@Controller('public/deposits/session/documents')
export class DepositDocumentsController {
  constructor(private readonly documentsService: DocumentsService) {}

  @Post()
  @ApiOperation({ summary: 'Obtenir une URL de depot signee' })
  @ApiResponse({ status: 201, type: UploadTicketView })
  @ApiResponse({ status: 400, description: 'Type, extension ou taille refuses' })
  @ApiResponse({ status: 409, description: 'Nombre maximal de documents atteint' })
  requestUpload(
    @CurrentDeposit() session: DepositSession,
    @Body() dto: RequestUploadDto,
  ): Promise<UploadTicketView> {
    return this.documentsService.requestUpload(session.requestId, dto);
  }

  @Post(':documentId/confirm')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Confirmer le depot apres le PUT vers le stockage' })
  @ApiResponse({ status: 200, type: DocumentView })
  @ApiResponse({ status: 400, description: 'Aucun fichier recu, ou fichier hors gabarit' })
  confirm(
    @CurrentDeposit() session: DepositSession,
    @Param('documentId', new ParseUUIDPipe()) documentId: string,
  ): Promise<DocumentView> {
    return this.documentsService.confirmUpload(session.requestId, documentId);
  }

  @Get()
  @ApiOperation({ summary: 'Lister les documents deja deposes' })
  @ApiResponse({ status: 200, type: [DocumentView] })
  list(@CurrentDeposit() session: DepositSession): Promise<DocumentView[]> {
    return this.documentsService.listForDeposit(session.requestId);
  }
}
