import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import {
  CreateBucketCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  PutBucketVersioningCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { randomUUID } from 'node:crypto';
import { loadConfig } from '../../config/configuration';

/**
 * S3-compatible object storage. MinIO in development and for a self-hosted
 * deployment, Backblaze B2 or Cloudflare R2 in production — all the same API, which
 * is the point of choosing S3 semantics over a provider SDK.
 *
 * The API never proxies file bytes. Uploads and downloads are presigned URLs the
 * browser uses directly, so a 12 MB scan of a rent agreement does not occupy a Node
 * process for the duration.
 */
@Injectable()
export class StorageService implements OnModuleInit {
  private readonly logger = new Logger(StorageService.name);
  private readonly cfg = loadConfig();
  private readonly client: S3Client;

  constructor() {
    this.client = new S3Client({
      region: this.cfg.S3_REGION,
      endpoint: this.cfg.S3_ENDPOINT,
      forcePathStyle: this.cfg.S3_FORCE_PATH_STYLE,
      credentials:
        this.cfg.S3_ACCESS_KEY_ID && this.cfg.S3_SECRET_ACCESS_KEY
          ? {
              accessKeyId: this.cfg.S3_ACCESS_KEY_ID,
              secretAccessKey: this.cfg.S3_SECRET_ACCESS_KEY,
            }
          : undefined,
    });
  }

  /**
   * Ensures the bucket exists and is versioned.
   *
   * Versioning is not optional for this bucket: it holds the partnership deed and the
   * FSSAI certificate, and an overwrite or a mistaken delete must be recoverable.
   * Managed providers (B2, R2) will already have it; this makes a self-hosted MinIO
   * match without a documented manual step someone will skip.
   */
  async onModuleInit(): Promise<void> {
    try {
      await this.client.send(new HeadBucketCommand({ Bucket: this.cfg.S3_BUCKET }));
    } catch {
      try {
        await this.client.send(new CreateBucketCommand({ Bucket: this.cfg.S3_BUCKET }));
        await this.client.send(
          new PutBucketVersioningCommand({
            Bucket: this.cfg.S3_BUCKET,
            VersioningConfiguration: { Status: 'Enabled' },
          }),
        );
        this.logger.log(`Created bucket ${this.cfg.S3_BUCKET} with versioning enabled`);
      } catch (err) {
        // Object storage being unreachable must not stop the shop from billing. Only the
        // document vault depends on it.
        this.logger.warn(
          `Object storage is not reachable (${(err as Error).message}). Billing and reports ` +
            'work; document upload and download will not.',
        );
      }
    }
  }

  /**
   * Keys are tenant-prefixed and contain a random component, so a key is not
   * guessable and never collides even when two partners upload `fssai.pdf`.
   */
  buildKey(tenantId: string, scope: string, fileName: string): string {
    const safe = fileName.replace(/[^\w.\-]+/g, '_').slice(-80);
    return `${tenantId}/${scope}/${new Date().getFullYear()}/${randomUUID()}-${safe}`;
  }

  async presignUpload(key: string, contentType: string, expiresIn = 900): Promise<string> {
    return getSignedUrl(
      this.client,
      new PutObjectCommand({
        Bucket: this.cfg.S3_BUCKET,
        Key: key,
        ContentType: contentType,
        ServerSideEncryption: 'AES256',
      }),
      { expiresIn },
    );
  }

  /** Short expiry: a download link that lives for hours is a link that gets forwarded. */
  async presignDownload(key: string, fileName?: string, expiresIn = 300): Promise<string> {
    return getSignedUrl(
      this.client,
      new GetObjectCommand({
        Bucket: this.cfg.S3_BUCKET,
        Key: key,
        ResponseContentDisposition: fileName ? `attachment; filename="${fileName}"` : undefined,
      }),
      { expiresIn },
    );
  }

  async putBuffer(key: string, body: Buffer, contentType: string): Promise<void> {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.cfg.S3_BUCKET,
        Key: key,
        Body: body,
        ContentType: contentType,
        ServerSideEncryption: 'AES256',
      }),
    );
  }

  async getBuffer(key: string): Promise<Buffer> {
    const res = await this.client.send(
      new GetObjectCommand({ Bucket: this.cfg.S3_BUCKET, Key: key }),
    );
    return Buffer.from(await res.Body!.transformToByteArray());
  }

  async delete(key: string): Promise<void> {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.cfg.S3_BUCKET, Key: key }));
    this.logger.warn(`Deleted object ${key}`);
  }
}
