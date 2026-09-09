import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import type { Env } from '../config/env.validation';

export interface ObjectStat {
  sizeBytes: number;
  etag: string | undefined;
  contentType: string | undefined;
}

/**
 * Seul module du projet qui connaisse S3.
 *
 * Tout le reste de l application parle a cette interface : les tests unitaires
 * n ont donc pas besoin de MinIO, et passer a AWS S3 ne demande que de changer
 * trois variables d environnement.
 *
 * Aucune methode n ecrit ni ne lit un fichier local. Il n y a volontairement
 * aucune fonction du type uploadFile(path) : les octets ne traversent jamais ce
 * process, ce sont des URLs signees qui circulent.
 */
@Injectable()
export class StorageService {
  private readonly logger = new Logger(StorageService.name);
  private readonly bucket: string;

  /**
   * Client de SIGNATURE, configure sur l endpoint PUBLIC.
   *
   * C est le piege numero un de ce montage : une signature SigV4 couvre
   * l en-tete Host. Une URL signee sur http://minio:9000 est syntaxiquement
   * correcte mais inutilisable par le navigateur, et l erreur ne se voit que
   * cote client. Le presigner utilise donc l endpoint public, tandis que les
   * appels serveur-a-serveur (HeadObject, Delete) passent par l endpoint
   * interne.
   */
  private readonly presignClient: S3Client;
  private readonly internalClient: S3Client;

  constructor(private readonly config: ConfigService<Env, true>) {
    this.bucket = config.get('S3_BUCKET', { infer: true });

    const credentials = {
      accessKeyId: config.get('S3_ACCESS_KEY', { infer: true }),
      secretAccessKey: config.get('S3_SECRET_KEY', { infer: true }),
    };
    const region = config.get('S3_REGION', { infer: true });

    // forcePathStyle : indispensable avec MinIO, et c est aussi ce qui place le
    // nom du bucket en premier segment du chemin. En production, nginx route
    // /<bucket>/* vers MinIO sans reecriture, donc la signature reste valide.
    const common = { region, credentials, forcePathStyle: true };

    this.presignClient = new S3Client({
      ...common,
      endpoint: config.get('S3_PUBLIC_ENDPOINT', { infer: true }),
    });

    this.internalClient = new S3Client({
      ...common,
      endpoint: config.get('S3_INTERNAL_ENDPOINT', { infer: true }),
    });
  }

  /**
   * URL de depot a usage unique.
   *
   * Deux limites assumees du PUT presigne, verifiees a la CONFIRMATION plutot
   * qu a la signature — la seule valeur digne de confiance etant celle que le
   * stockage rapporte apres coup :
   *  - la taille : contrairement a une policy POST, un PUT signe ne permet pas
   *    d imposer content-length-range ;
   *  - le type : le Content-Type passe dans la commande n est pas impose au
   *    client, qui peut televerser sous un autre type (constate en test).
   */
  async createUploadUrl(
    key: string,
    contentType: string,
  ): Promise<{ url: string; expiresAt: Date }> {
    const ttl = this.config.get('PRESIGN_UPLOAD_TTL_SECONDS', { infer: true });

    const url = await getSignedUrl(
      this.presignClient,
      new PutObjectCommand({ Bucket: this.bucket, Key: key, ContentType: contentType }),
      { expiresIn: ttl },
    );

    return { url, expiresAt: new Date(Date.now() + ttl * 1000) };
  }

  /**
   * URL de telechargement temporaire.
   *
   * Le bucket reste strictement prive : aucune politique anonyme, aucun objet
   * accessible sans signature. La duree est volontairement tres courte, et le
   * nom d origine est reinjecte via Content-Disposition — la cle de stockage,
   * elle, est un identifiant technique.
   */
  async createDownloadUrl(key: string, originalName: string): Promise<string> {
    const ttl = this.config.get('PRESIGN_DOWNLOAD_TTL_SECONDS', { infer: true });

    return getSignedUrl(
      this.presignClient,
      new GetObjectCommand({
        Bucket: this.bucket,
        Key: key,
        ResponseContentDisposition: contentDisposition(originalName),
      }),
      { expiresIn: ttl },
    );
  }

  /**
   * Etat reel de l objet cote stockage.
   *
   * C est ce qui permet de ne jamais faire confiance a la taille annoncee par
   * le client : la ligne en base ne devient AVAILABLE qu apres cette lecture.
   * Renvoie null si l objet n existe pas.
   */
  async statObject(key: string): Promise<ObjectStat | null> {
    try {
      const head = await this.internalClient.send(
        new HeadObjectCommand({ Bucket: this.bucket, Key: key }),
      );
      return {
        sizeBytes: head.ContentLength ?? 0,
        etag: head.ETag,
        contentType: head.ContentType,
      };
    } catch (error: unknown) {
      const status = (error as { $metadata?: { httpStatusCode?: number } }).$metadata
        ?.httpStatusCode;
      if (status === 404 || status === 403) return null;
      throw error;
    }
  }

  /** Supprime un objet. Utilise pour nettoyer un depot non conforme. */
  async removeObject(key: string): Promise<void> {
    await this.internalClient.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
    this.logger.warn(`Objet supprime : ${key}`);
  }

  /** Sonde de disponibilite pour /health/ready. */
  async isReachable(): Promise<boolean> {
    try {
      await this.internalClient.send(new HeadBucketCommand({ Bucket: this.bucket }));
      return true;
    } catch {
      return false;
    }
  }
}

/**
 * En-tete Content-Disposition robuste.
 *
 * Deux formes : une version ASCII degradee pour les clients anciens, et la
 * version RFC 5987 pour l unicode (accents, cyrillique). Les guillemets et les
 * caracteres de controle sont retires — un nom de fichier vient du client, il
 * ne doit pas pouvoir injecter d en-tete.
 */
function contentDisposition(originalName: string): string {
  const cleaned = originalName.replace(/[\r\n"\\]/g, '').trim() || 'document';
  const ascii = cleaned.replace(/[^\x20-\x7E]/g, '_');
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(cleaned)}`;
}
