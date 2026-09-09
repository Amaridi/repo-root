import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../config/env.validation';
import { DepositAccessService } from '../deposit-access/deposit-access.service';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { buildStorageKey, validateDeclaredFile } from './document-rules';
import { type DocumentView, type UploadTicketView, toDocumentView } from './dto/document.view';
import type { RequestUploadDto } from './dto/request-upload.dto';

@Injectable()
export class DocumentsService {
  private readonly logger = new Logger(DocumentsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly depositAccess: DepositAccessService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  // ---------------------------------------------------------------------------
  // Cote client, apres validation du PIN
  // ---------------------------------------------------------------------------

  /**
   * Autorise un depot et renvoie une URL signee.
   *
   * Le serveur ne recoit ici que des METADONNEES. Il decide, enregistre une
   * ligne PENDING, et delegue le transfert au navigateur. Aucun octet de
   * fichier n atteint ce process, donc aucun ne peut atterrir sur son disque.
   */
  async requestUpload(requestId: string, dto: RequestUploadDto): Promise<UploadTicketView> {
    // Reverifie systematiquement que la demande est encore ouverte : la session
    // peut avoir ete emise avant l expiration du lien.
    await this.depositAccess.assertOpenForDeposit(requestId);

    const maxBytes = this.config.get('UPLOAD_MAX_BYTES', { infer: true });
    const rejection = validateDeclaredFile(dto.filename, dto.mimeType, dto.sizeBytes, maxBytes);
    if (rejection) {
      throw new BadRequestException({ message: rejection.detail, reason: rejection.reason });
    }

    const maxFiles = this.config.get('UPLOAD_MAX_FILES_PER_REQUEST', { infer: true });
    const existing = await this.prisma.document.count({ where: { requestId } });
    if (existing >= maxFiles) {
      throw new ConflictException(`Nombre maximal de documents atteint (${maxFiles}).`);
    }

    const { documentId, storageKey } = buildStorageKey(requestId, dto.filename);

    await this.prisma.document.create({
      data: {
        id: documentId,
        requestId,
        originalName: dto.filename,
        storageKey,
        mimeType: dto.mimeType,
        // Taille ANNONCEE : elle sera remplacee par la taille reelle a la
        // confirmation. Tant que le document est PENDING, elle n a valeur
        // d aucune garantie.
        sizeBytes: BigInt(dto.sizeBytes),
      },
    });

    const { url, expiresAt } = await this.storage.createUploadUrl(storageKey, dto.mimeType);

    return {
      documentId,
      uploadUrl: url,
      // En-tete attendu pour que l objet soit stocke avec le bon type. Il
      // n est PAS impose par la signature : la conformite est verifiee a la
      // confirmation, sur ce que le stockage rapporte reellement.
      requiredHeaders: { 'Content-Type': dto.mimeType },
      expiresAt,
    };
  }

  /**
   * Confirme un depot apres verification cote stockage.
   *
   * C est le point ou la ligne cesse d etre une promesse. Sans cette etape, la
   * liste de l avocat contiendrait des documents fantomes : la ligne existe des
   * l autorisation, alors que les octets, eux, peuvent ne jamais arriver.
   */
  async confirmUpload(requestId: string, documentId: string): Promise<DocumentView> {
    await this.depositAccess.assertOpenForDeposit(requestId);

    const document = await this.prisma.document.findFirst({
      where: { id: documentId, requestId },
    });
    if (!document) {
      throw new NotFoundException('Document introuvable.');
    }
    if (document.status === 'AVAILABLE') {
      return toDocumentView(document);
    }

    const stat = await this.storage.statObject(document.storageKey);
    if (!stat) {
      throw new BadRequestException('Aucun fichier recu pour ce document.');
    }

    // La taille reelle est la seule digne de confiance : l URL signee en PUT ne
    // permet pas d imposer une borne, contrairement a une policy POST. Un
    // fichier hors gabarit est donc supprime du stockage, pas seulement rejete.
    const maxBytes = this.config.get('UPLOAD_MAX_BYTES', { infer: true });
    if (stat.sizeBytes <= 0 || stat.sizeBytes > maxBytes) {
      await this.rejectStoredObject(document.id, document.storageKey);
      throw new BadRequestException('Le fichier recu est vide ou depasse la taille autorisee.');
    }

    // Le type reel est verifie ICI et non a la signature.
    //
    // Une URL presignee en PUT ne contraint pas les en-tetes que le client
    // envoie : un depot annonce en application/pdf peut arriver en text/plain,
    // ce qui a ete constate en test. La seule valeur digne de confiance est
    // celle que le stockage rapporte apres coup.
    if (stat.contentType && stat.contentType !== document.mimeType) {
      await this.rejectStoredObject(document.id, document.storageKey);
      throw new BadRequestException(
        `Le fichier recu (${stat.contentType}) ne correspond pas au type annonce (${document.mimeType}).`,
      );
    }

    const [updated] = await this.prisma.$transaction([
      this.prisma.document.update({
        where: { id: document.id },
        data: {
          status: 'AVAILABLE',
          sizeBytes: BigInt(stat.sizeBytes),
          confirmedAt: new Date(),
        },
      }),
      // Premier document confirme : la demande passe de PENDING a IN_PROGRESS.
      // updateMany avec le statut dans le WHERE rend l operation idempotente et
      // evite d ecraser un statut SUBMITTED ou CLOSED.
      this.prisma.depositRequest.updateMany({
        where: { id: requestId, status: 'PENDING' },
        data: { status: 'IN_PROGRESS' },
      }),
    ]);

    this.logger.log(`Document confirme ${document.id} (${stat.sizeBytes} octets)`);
    return toDocumentView(updated);
  }

  /** Documents de SA demande, et d aucune autre : requestId vient de la session. */
  async listForDeposit(requestId: string): Promise<DocumentView[]> {
    await this.depositAccess.assertOpenForDeposit(requestId);

    const documents = await this.prisma.document.findMany({
      where: { requestId, status: 'AVAILABLE' },
      orderBy: { createdAt: 'asc' },
    });

    return documents.map(toDocumentView);
  }

  // ---------------------------------------------------------------------------
  // Cote avocat
  // ---------------------------------------------------------------------------

  /** Documents d une demande appartenant a l avocat courant. */
  async listForLawyer(lawyerId: string, requestId: string): Promise<DocumentView[]> {
    await this.assertOwnedByLawyer(lawyerId, requestId);

    const documents = await this.prisma.document.findMany({
      where: { requestId, status: 'AVAILABLE' },
      orderBy: { createdAt: 'asc' },
    });

    return documents.map(toDocumentView);
  }

  /**
   * URL de telechargement temporaire.
   *
   * Les identifiants MinIO ne quittent jamais le serveur : le client recoit une
   * signature a duree tres courte, portant sur un seul objet.
   */
  async createDownloadUrl(
    lawyerId: string,
    requestId: string,
    documentId: string,
  ): Promise<string> {
    await this.assertOwnedByLawyer(lawyerId, requestId);

    const document = await this.prisma.document.findFirst({
      where: { id: documentId, requestId, status: 'AVAILABLE' },
    });
    if (!document) {
      throw new NotFoundException('Document introuvable.');
    }

    return this.storage.createDownloadUrl(document.storageKey, document.originalName);
  }

  /** Retire un objet non conforme du stockage ET sa ligne de metadonnees. */
  private async rejectStoredObject(documentId: string, storageKey: string): Promise<void> {
    await this.storage.removeObject(storageKey);
    await this.prisma.document.delete({ where: { id: documentId } });
  }

  /**
   * Appartenance verifiee dans le WHERE. Une demande valide appartenant a un
   * autre avocat produit exactement la meme reponse qu une demande inexistante.
   */
  private async assertOwnedByLawyer(lawyerId: string, requestId: string): Promise<void> {
    const owned = await this.prisma.depositRequest.findFirst({
      where: { id: requestId, lawyerId },
      select: { id: true },
    });

    if (!owned) {
      throw new NotFoundException('Demande de depot introuvable.');
    }
  }
}
