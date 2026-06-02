/**
 * MODULE: shared.storage.r2
 * PURPOSE: Upload venue photos to Cloudflare R2 (S3-compatible) and return the
 *          public URL to store in `venue.photoUrl`. The single place that talks
 *          to object storage; the admin upload route is the only consumer.
 * LAYER: shared / infrastructure
 * DEPENDENCIES: @aws-sdk/client-s3, src/shared/config/env, node:crypto
 * CONSUMED BY: app/api/admin/venues/photo/route.ts
 * INVARIANTS:
 *   - All five R2_* env vars are OPTIONAL to boot (same convention as
 *     Resend/Ably). `isPhotoStorageConfigured()` is the single gate — the route
 *     calls it and returns 503 `photo_storage_unconfigured` when false, so the
 *     paste-a-URL fallback keeps working. `uploadVenuePhoto` re-checks and
 *     throws `photo_storage_unconfigured` as a backstop.
 *   - The S3 client is built once, lazily, only after the config check passes.
 *   - Keys are `venues/<uuid>.<ext>`; uploads never overwrite (no collisions),
 *     so replacing a venue photo orphans the old object (cheap — left for a
 *     future sweep). // TODO(cleanup): delete-on-replace.
 *   - `requestChecksumCalculation: WHEN_REQUIRED` — the AWS SDK's default
 *     flexible-checksum header trips some S3-compatible stores; R2 is happiest
 *     without it on a plain PutObject.
 * RELATED DOCS: .env.example → "VENUE PHOTO STORAGE".
 */
import { randomUUID } from "node:crypto";

import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";

import { env } from "@/src/shared/config/env";
import { AppError } from "@/src/shared/errors/app-error";

/** Image MIME types the upload route accepts, mapped to a file extension. */
export const ALLOWED_PHOTO_TYPES: Readonly<Record<string, string>> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

/** Hard cap on a single upload, mirrored client- and server-side. */
export const MAX_PHOTO_BYTES = 5 * 1024 * 1024;

interface R2Config {
  readonly accountId: string;
  readonly accessKeyId: string;
  readonly secretAccessKey: string;
  readonly bucket: string;
  readonly publicBaseUrl: string;
}

/** Resolve the config iff ALL five vars are present; otherwise `null`. */
function readConfig(): R2Config | null {
  const {
    R2_ACCOUNT_ID,
    R2_ACCESS_KEY_ID,
    R2_SECRET_ACCESS_KEY,
    R2_BUCKET,
    R2_PUBLIC_BASE_URL,
  } = env;
  if (
    !R2_ACCOUNT_ID ||
    !R2_ACCESS_KEY_ID ||
    !R2_SECRET_ACCESS_KEY ||
    !R2_BUCKET ||
    !R2_PUBLIC_BASE_URL
  ) {
    return null;
  }
  return {
    accountId: R2_ACCOUNT_ID,
    accessKeyId: R2_ACCESS_KEY_ID,
    secretAccessKey: R2_SECRET_ACCESS_KEY,
    bucket: R2_BUCKET,
    publicBaseUrl: R2_PUBLIC_BASE_URL.replace(/\/+$/, ""),
  };
}

/** True when uploads are possible (all five R2_* vars set). */
export function isPhotoStorageConfigured(): boolean {
  return readConfig() !== null;
}

let client: S3Client | null = null;

function getClient(cfg: R2Config): S3Client {
  if (!client) {
    client = new S3Client({
      region: "auto",
      endpoint: `https://${cfg.accountId}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId: cfg.accessKeyId,
        secretAccessKey: cfg.secretAccessKey,
      },
      requestChecksumCalculation: "WHEN_REQUIRED",
      responseChecksumValidation: "WHEN_REQUIRED",
    });
  }
  return client;
}

/**
 * Store an image in R2 and return its public URL (`${R2_PUBLIC_BASE_URL}/<key>`).
 * `contentType` must be a key of {@link ALLOWED_PHOTO_TYPES}; the route validates
 * it before calling. Throws `photo_storage_unconfigured` (503) if R2 is unset.
 */
export async function uploadVenuePhoto(
  bytes: Uint8Array,
  contentType: string,
): Promise<string> {
  const cfg = readConfig();
  if (!cfg) {
    throw new AppError(
      "photo_storage_unconfigured",
      "R2 photo storage is not configured",
      503,
    );
  }
  const ext = ALLOWED_PHOTO_TYPES[contentType] ?? "bin";
  const key = `venues/${randomUUID()}.${ext}`;

  await getClient(cfg).send(
    new PutObjectCommand({
      Bucket: cfg.bucket,
      Key: key,
      Body: bytes,
      ContentType: contentType,
      CacheControl: "public, max-age=31536000, immutable",
    }),
  );

  return `${cfg.publicBaseUrl}/${key}`;
}
