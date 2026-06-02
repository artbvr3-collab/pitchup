/**
 * MODULE: app.api.admin.venues.photo.route
 * PURPOSE: HTTP entry — admin uploads a venue photo. `requireAdmin` → validate
 *          the multipart file (type + size) → `uploadVenuePhoto` (R2) → returns
 *          `{ ok, url }`. The admin form sets the venue's `photoUrl` to `url`,
 *          then saves via the existing POST/PATCH /api/admin/venues endpoints.
 * LAYER: interfaces
 * DEPENDENCIES: src/auth/composition (requireAdmin),
 *               src/shared/storage/r2 (uploadVenuePhoto + guards),
 *               src/shared/errors/{app-error, http-mapping}
 * INVARIANTS:
 *   - `requireAdmin()` first — 401 / 403 admin_required before any work.
 *   - 503 `photo_storage_unconfigured` when R2 is unset (checked up front so the
 *     client can fall back to the paste-a-URL field with a clear message).
 *   - The file field is `photo`. Non-file / missing → 400 `photo_missing`;
 *     wrong type → 400 `photo_invalid_type`; over MAX_PHOTO_BYTES → 413
 *     `photo_too_large`. Codes are the stable contract the form dispatches on.
 *   - This endpoint only stores the object; it does NOT touch the Venue row.
 * RELATED DOCS: .env.example → "VENUE PHOTO STORAGE".
 */
import { NextResponse } from "next/server";

import { requireAdmin } from "@/src/auth/composition";
import { AppError } from "@/src/shared/errors/app-error";
import { toHttpResponse } from "@/src/shared/errors/http-mapping";
import {
  ALLOWED_PHOTO_TYPES,
  isPhotoStorageConfigured,
  MAX_PHOTO_BYTES,
  uploadVenuePhoto,
} from "@/src/shared/storage/r2";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request): Promise<NextResponse> {
  try {
    await requireAdmin();

    if (!isPhotoStorageConfigured()) {
      throw new AppError(
        "photo_storage_unconfigured",
        "R2 photo storage is not configured",
        503,
      );
    }

    const form = await req.formData();
    const file = form.get("photo");
    if (!(file instanceof File)) {
      throw new AppError("photo_missing", "No photo file in request", 400);
    }
    if (!(file.type in ALLOWED_PHOTO_TYPES)) {
      throw new AppError(
        "photo_invalid_type",
        `Unsupported type ${file.type}`,
        400,
      );
    }
    if (file.size > MAX_PHOTO_BYTES) {
      throw new AppError("photo_too_large", "Photo exceeds size limit", 413);
    }

    const bytes = new Uint8Array(await file.arrayBuffer());
    const url = await uploadVenuePhoto(bytes, file.type);

    return NextResponse.json({ ok: true, url }, { status: 201 });
  } catch (err) {
    return toHttpResponse(err);
  }
}
