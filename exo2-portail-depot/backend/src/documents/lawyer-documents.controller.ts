import { Controller, Get, Param, ParseUUIDPipe, Redirect, UseGuards } from '@nestjs/common';
import { ApiCookieAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { AuthenticatedLawyer } from '../auth/auth.types';
import { CurrentLawyer } from '../auth/decorators/current-lawyer.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { DocumentsService } from './documents.service';
import { DocumentView } from './dto/document.view';

/**
 * Consultation des pieces cote AVOCAT.
 */
@ApiTags('deposits')
@ApiCookieAuth()
@UseGuards(JwtAuthGuard)
@Controller('deposits/:requestId/documents')
export class LawyerDocumentsController {
  constructor(private readonly documentsService: DocumentsService) {}

  @Get()
  @ApiOperation({ summary: 'Lister les documents deposes sur une de ses demandes' })
  @ApiResponse({ status: 200, type: [DocumentView] })
  @ApiResponse({ status: 404, description: 'Demande inexistante ou appartenant a un autre avocat' })
  list(
    @CurrentLawyer() lawyer: AuthenticatedLawyer,
    @Param('requestId', new ParseUUIDPipe()) requestId: string,
  ): Promise<DocumentView[]> {
    return this.documentsService.listForLawyer(lawyer.id, requestId);
  }

  /**
   * Redirection 302 vers une URL signee de courte duree.
   *
   * Le fichier n est pas relaye par l API : le navigateur va le chercher
   * directement dans le stockage. Les identifiants MinIO ne quittent jamais le
   * serveur, et l URL cesse de fonctionner en une minute.
   */
  @Get(':documentId/download')
  @Redirect()
  @ApiOperation({ summary: 'Telecharger via une URL temporaire signee' })
  @ApiResponse({ status: 302, description: 'Redirection vers l URL signee' })
  @ApiResponse({ status: 404, description: 'Document introuvable' })
  async download(
    @CurrentLawyer() lawyer: AuthenticatedLawyer,
    @Param('requestId', new ParseUUIDPipe()) requestId: string,
    @Param('documentId', new ParseUUIDPipe()) documentId: string,
  ): Promise<{ url: string; statusCode: number }> {
    const url = await this.documentsService.createDownloadUrl(lawyer.id, requestId, documentId);
    return { url, statusCode: 302 };
  }
}
