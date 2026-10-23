import path from "path";
import { createReadStream } from "fs";
import type { Readable } from "stream";
import { Storage, type Bucket } from "@google-cloud/storage";
import type { PresignedPost } from "@aws-sdk/s3-presigned-post";
import fs from "fs-extra";
import safeResolvePath from "resolve-path";
import tmp from "tmp";
import env from "@server/env";
import Logger from "@server/logging/Logger";
import BaseStorage from "./BaseStorage";
import { CSRF } from "@shared/constants";
import type { AppContext } from "@server/types";

/**
 * Google Cloud Storage implementation.
 *
 * Follows the same contract as S3Storage but uses
 * the @google-cloud/storage SDK instead of the AWS SDK.
 */
export default class GCSStorage extends BaseStorage {
  private client: Storage;
  private bucket: Bucket;

  constructor() {
    super();

    this.client = new Storage({
      projectId: env.GCS_PROJECT_ID ?? undefined,
      keyFilename: env.GCS_KEY_FILE_PATH ?? undefined,
    });

    const bucketName = env.GCS_BUCKET_NAME;
    if (!bucketName) {
      throw new Error("GCS_BUCKET_NAME is required when using GCS storage");
    }

    this.bucket = this.client.bucket(bucketName);
    Logger.info(
      "lifecycle",
      `GCS Storage initialized with bucket: ${bucketName}`
    );
  }

  /**
   * Generate presigned post fields for server-side proxy upload.
   *
   * Unlike S3 (which POSTs directly to the bucket), GCS uploads go through
   * the server to avoid CORS issues. The server receives the file via
   * /api/files.create and then uploads it to GCS using store().
   * This mirrors the LocalStorage approach.
   */
  public async getPresignedPost(
    ctx: AppContext,
    key: string,
    acl: string,
    maxUploadSize: number,
    contentType = "image"
  ): Promise<Partial<PresignedPost>> {
    return Promise.resolve({
      url: this.getUrlForKey(key),
      fields: {
        key,
        acl,
        maxUploadSize: String(maxUploadSize),
        contentType,
        [CSRF.fieldName]: ctx.cookies.get(CSRF.cookieName) || "",
      },
    });
  }

  /**
   * Returns the server-side upload endpoint.
   * Uploads go through the server (like LocalStorage) to avoid CORS.
   */
  public getUploadUrl(_isServerUpload?: boolean): string {
    return "/api/files.create";
  }

  /**
   * Returns the URL to access a file via the server proxy.
   */
  public getUrlForKey(key: string): string {
    return `/api/files.get?key=${key}`;
  }

  /**
   * Upload a file to GCS.
   *
   * Supports Buffer, Uint8Array, string, and Readable streams.
   * Uses createWriteStream for efficient streaming uploads, with
   * resumable mode enabled for files larger than 5 MB.
   */
  public store = async ({
    body,
    contentType,
    contentLength,
    key,

  }: {
    body: Buffer | Uint8Array | string | Readable;
    contentLength?: number;
    contentType?: string;
    key: string;
    acl?: string;
  }): Promise<string> => {
    const file = this.bucket.file(key);

    const options: {
      metadata: Record<string, string>;
      resumable: boolean;
    } = {
      metadata: {
        contentType: contentType || "application/octet-stream",
        cacheControl: "public, max-age=31536000, immutable",
      },
      // Enable resumable uploads for files > 5 MB
      resumable: contentLength ? contentLength > 5 * 1024 * 1024 : false,
    };

    return new Promise<string>((resolve, reject) => {
      const stream = file.createWriteStream(options);

      stream.on("error", (error) => {
        Logger.error("GCS upload error", error, { key });
        reject(error);
      });

      stream.on("finish", () => {
        Logger.debug("lifecycle", `File uploaded to GCS: ${key}`);
        resolve(this.getUrlForKey(key));
      });

      if (typeof body === "string") {
        stream.end(body);
      } else if (body instanceof Buffer || body instanceof Uint8Array) {
        stream.end(body);
      } else {
        // Readable stream
        (body as Readable)
          .on("error", (error) => {
            stream.destroy();
            reject(error);
          })
          .pipe(stream);
      }
    });
  };

  /**
   * Delete a file from GCS.
   */
  public async deleteFile(key: string): Promise<void> {
    try {
      await this.bucket.file(key).delete();
      Logger.debug("lifecycle", `File deleted from GCS: ${key}`);
    } catch (error) {
      Logger.warn(`Failed to delete file from GCS: ${key}`, error);
    }
  }

  /**
   * Generate a signed URL for temporary read access to a file.
   *
   * Uses v4 signatures with a configurable expiration.
   * GCS v4 signed URLs have a max lifetime of 7 days,
   * matching the S3 Signature V4 limit.
   */
  public getSignedUrl = async (
    key: string,
    expiresIn = GCSStorage.defaultSignedUrlExpires
  ): Promise<string> => {
    const file = this.bucket.file(key);

    // Clamp to 7-day maximum (same as S3 v4 limit)
    const clampedExpiresIn = Math.min(
      expiresIn,
      GCSStorage.maxSignedUrlExpires
    );

    const [url] = await file.getSignedUrl({
      version: "v4",
      action: "read",
      expires: Date.now() + clampedExpiresIn * 1000,
    });

    return url;
  };

  /**
   * Get a readable stream for a file, with optional byte-range support.
   *
   * Falls back to local storage for files not yet migrated to GCS.
   */
  public async getFileStream(
    key: string,
    range?: { start: number; end: number }
  ): Promise<NodeJS.ReadableStream | null> {
    // Check if file exists on GCS first
    const gcsExists = await this.getFileExists(key);

    if (gcsExists) {
      const options: { start?: number; end?: number } = {};
      if (range) {
        options.start = range.start;
        options.end = range.end;
      }
      return this.bucket.file(key).createReadStream(options);
    }

    // Fallback: try local file for pre-migration data
    const localPath = this.getLocalPath(key);
    if (localPath && (await fs.pathExists(localPath))) {
      Logger.info("lifecycle", `GCS fallback to local for stream: ${key}`);
      return createReadStream(localPath, range ? { start: range.start, end: range.end } : undefined);
    }

    Logger.warn(`File not found in GCS or local: ${key}`);
    return null;
  }

  /**
   * Download a file to a temp directory and return its path.
   *
   * This mirrors S3Storage: the caller is responsible for calling
   * cleanup() when done to remove the temp file.
   */
  public getFileHandle(key: string): Promise<{
    path: string;
    cleanup: () => Promise<void>;
  }> {
    return new Promise((resolve, reject) => {
      tmp.dir((err, tmpDir) => {
        if (err) {
          return reject(err);
        }
        const tmpFile = path.join(tmpDir, "tmp");
        const dest = fs.createWriteStream(tmpFile);
        dest.on("error", reject);
        dest.on("finish", () =>
          resolve({ path: tmpFile, cleanup: () => fs.rm(tmpFile) })
        );

        const stream = this.bucket.file(key).createReadStream();
        stream
          .on("error", (error) => {
            dest.end();
            reject(error);
          })
          .pipe(dest);
      });
    });
  }

  /**
   * Check whether a file exists in the bucket.
   */
  public async getFileExists(key: string): Promise<boolean> {
    try {
      const [exists] = await this.bucket.file(key).exists();
      return exists;
    } catch {
      return false;
    }
  }

  /**
   * Get file metadata (size). Required by the files.get route for
   * Content-Length headers and byte-range requests.
   *
   * Falls back to local storage for files not yet migrated to GCS.
   */
  public async stat(key: string): Promise<{ size: number }> {
    try {
      const file = this.bucket.file(key);
      const [metadata] = await file.getMetadata();
      return { size: parseInt(String(metadata.size) || "0", 10) };
    } catch (error: any) {
      if (error.code === 404) {
        // Fallback: try local file for pre-migration data
        const localPath = this.getLocalPath(key);
        if (localPath && (await fs.pathExists(localPath))) {
          Logger.info("lifecycle", `GCS fallback to local for stat: ${key}`);
          const localStat = await fs.stat(localPath);
          return { size: localStat.size };
        }
      }
      throw error;
    }
  }

  /**
   * Move (rename) a file within the same bucket.
   *
   * GCS does not have a native rename – this performs a copy then delete.
   */
  public moveFile = async (
    fromKey: string,
    toKey: string
  ): Promise<void> => {
    const sourceFile = this.bucket.file(fromKey);
    await sourceFile.copy(this.bucket.file(toKey));
    await sourceFile.delete();
  };

  /**
   * Resolve a storage key to a local file path for fallback reads.
   * Used during migration period when some files are still on local disk.
   */
  private getLocalPath(key: string): string | null {
    const localRoot = env.FILE_STORAGE_LOCAL_ROOT_DIR;
    if (!localRoot) {
      return null;
    }
    try {
      return safeResolvePath(localRoot, key);
    } catch {
      return null;
    }
  }
}
