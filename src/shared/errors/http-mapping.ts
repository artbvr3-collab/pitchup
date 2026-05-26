/**
 * MODULE: shared.errors.http-mapping
 * PURPOSE: Single place that turns a thrown error into a Route Handler
 *          response. `AppError` carries its own `code` + `httpStatus`; other
 *          errors are mapped to 500 with `internal_error`.
 * LAYER: shared / interfaces glue
 * DEPENDENCIES: ./app-error, zod (ZodError narrowing only — type-only at
 *               runtime via instanceof check on its presence in payload)
 * CONSUMED BY: every `app/api/.../route.ts`
 * INVARIANTS:
 *   - Response body shape is `{ code: string, message?: string,
 *     meta?: object }`. Stable contract — clients dispatch on `code`.
 *   - 5xx responses log the original error; 4xx do not (expected).
 *   - `ZodError` is collapsed to `400 validation_failed` with the flattened
 *     field errors under `meta.fields`.
 * RELATED DOCS: docs/ARCHITECTURE.md §6, ADR-0002.
 */
import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { AppError, ValidationError } from "./app-error";

export interface HttpErrorBody {
  readonly code: string;
  readonly message?: string;
  readonly meta?: Record<string, unknown>;
}

export function toHttpResponse(err: unknown): NextResponse<HttpErrorBody> {
  if (err instanceof ZodError) {
    const validation = new ValidationError({ fields: err.flatten().fieldErrors });
    return jsonError(validation);
  }
  if (err instanceof AppError) {
    return jsonError(err);
  }
  // Unknown / infrastructure error — never leak the message to the client.
  console.error("[http-mapping] unhandled error", err);
  return NextResponse.json(
    { code: "internal_error", message: "Something went wrong" },
    { status: 500 },
  );
}

function jsonError(err: AppError): NextResponse<HttpErrorBody> {
  const hasMeta = Object.keys(err.meta).length > 0;
  const body: HttpErrorBody = hasMeta
    ? { code: err.code, meta: err.meta }
    : { code: err.code };
  return NextResponse.json(body, { status: err.httpStatus });
}
