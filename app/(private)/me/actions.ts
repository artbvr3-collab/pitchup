/**
 * MODULE: app.(private).me.actions
 * PURPOSE: Server Actions for `/me`. Two actions:
 *          - `updateProfileAction(input)` — validates name + contactInfo +
 *            emailNotifications, invokes `UpdateProfileService`, revalidates
 *            `/me` so the page re-renders with the new values.
 *          - `signOutAction()` — Auth.js v5 sign-out, returns to `/`.
 *          Allowed under ADR-0001 because `/me` is one of the two routes
 *          exempted from "mutations via Route Handlers" (the other is
 *          `/welcome`). See ARCHITECTURE.md §5.
 * LAYER: interfaces
 * DEPENDENCIES: src/auth/composition (requireAuth + updateProfileService),
 *               src/auth/infrastructure/auth (signOut)
 * INVARIANTS:
 *   - `userId` is taken from the session (requireAuth), NEVER from the
 *     client payload. The form has no user-id field; the action enforces
 *     "edit your own profile only". This is the sensitivity gate.
 *   - Errors from the service (InvalidNameError / ContactInfoTooLongError)
 *     surface as `{ ok: false, code }` so the client form can show a
 *     field-level error without crashing the page. The Server Action
 *     itself never throws on a 4xx — that would render the Next.js error
 *     boundary.
 *   - `revalidatePath('/me')` is the only side-effect besides the DB
 *     write; the toggle path uses the same revalidate so the optimistic
 *     UI in the client island stays consistent with the server.
 * RELATED DOCS:
 *   - docs/spec/pitchup-spec-personal.md → "/me" → Section ACCOUNT,
 *     Section NOTIFICATIONS, Section ACCOUNT ACTIONS
 *   - docs/adr/0001-rest-routes-over-server-actions.md
 */
"use server";

import { revalidatePath } from "next/cache";

import { requireAuth, updateProfileService } from "@/src/auth/composition";
import {
  ContactInfoTooLongError,
  InvalidNameError,
} from "@/src/auth/application/update-profile-service";
import { signOut } from "@/src/auth/infrastructure/auth";
import { AppError } from "@/src/shared/errors/app-error";

export type UpdateProfileActionResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly code: string; readonly message: string };

export interface UpdateProfileInputDto {
  readonly name?: string;
  readonly contactInfo?: string | null;
  readonly emailNotifications?: boolean;
}

export async function updateProfileAction(
  input: UpdateProfileInputDto,
): Promise<UpdateProfileActionResult> {
  try {
    const session = await requireAuth();
    // Build the service input selectively so `exactOptionalPropertyTypes`
    // is happy — only set keys whose values are actually defined.
    const request: Parameters<
      typeof updateProfileService.execute
    >[0] = { userId: session.userId };
    if (input.name !== undefined) {
      (request as { name: string }).name = input.name;
    }
    if (input.contactInfo !== undefined) {
      (request as { contactInfo: string | null }).contactInfo =
        input.contactInfo;
    }
    if (input.emailNotifications !== undefined) {
      (request as { emailNotifications: boolean }).emailNotifications =
        input.emailNotifications;
    }
    await updateProfileService.execute(request);
    revalidatePath("/me");
    return { ok: true };
  } catch (err) {
    if (
      err instanceof InvalidNameError ||
      err instanceof ContactInfoTooLongError
    ) {
      return { ok: false, code: err.code, message: err.message };
    }
    if (err instanceof AppError) {
      return { ok: false, code: err.code, message: err.message };
    }
    // Unknown — let the client show a generic toast. Don't leak details.
    return {
      ok: false,
      code: "internal_error",
      message: "Something went wrong",
    };
  }
}

export async function signOutAction(): Promise<void> {
  await signOut({ redirectTo: "/" });
}
