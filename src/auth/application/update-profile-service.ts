/**
 * MODULE: auth.application.update-profile-service
 * PURPOSE: Use case — authenticated user edits their own profile from
 *          `/me → Edit profile`. Validates each field per spec global.md
 *          "Text field validation & sanitization" (trim, NFC normalize,
 *          length cap) and persists via `UserRepository.updateProfile`.
 * LAYER: application
 * DEPENDENCIES: ../domain/user, ../domain/user-repository, ../../shared/errors
 * CONSUMED BY: src/auth/composition.ts → app/(private)/me/actions.ts
 * INVARIANTS:
 *   - The caller (Server Action) already verified the session via
 *     `requireAuth`. This service edits ONLY the caller's own row — the
 *     `userId` argument MUST come from the session, never from the form.
 *     Server Action enforces this contract; the service trusts the input.
 *   - Per spec global.md "Text field validation & sanitization": every
 *     string field is `.trim()` + `.normalize('NFC')` + length-checked.
 *   - `name` is mandatory (≥1 char after trim) and capped at 100 chars
 *     (same cap as welcome onboarding). Empty input → `InvalidNameError`.
 *   - `contactInfo` is optional. After trim:
 *       · empty string → stored as NULL (clear the field)
 *       · non-empty   → must be ≤ 200 chars per spec table.
 *   - `emailNotifications` is a plain boolean; no normalization needed.
 *   - Avatar and email are NOT editable in v1 (spec personal.md "What is
 *     NOT on /me" + "Known gaps → Email address change — no UI to edit").
 * RELATED DOCS:
 *   - docs/spec/pitchup-spec-personal.md → "/me" → Section ACCOUNT
 *   - docs/spec/pitchup-spec-global.md → "Text field validation &
 *     sanitization" (limits table)
 */
import { AppError } from "@/src/shared/errors/app-error";

import type { User, UserId } from "../domain/user";
import type {
  UpdateProfileInput,
  UserRepository,
} from "../domain/user-repository";

const NAME_MAX = 100;
const CONTACT_INFO_MAX = 200;

/** `400 invalid_name` — empty after trim or length > 100. */
export class InvalidNameError extends AppError {
  constructor(meta: Record<string, unknown> = {}) {
    super("invalid_name", "Name must be 1–100 characters", 400, meta);
  }
}

/** `400 contact_info_too_long` — length > 200 after trim. */
export class ContactInfoTooLongError extends AppError {
  constructor(meta: Record<string, unknown> = {}) {
    super(
      "contact_info_too_long",
      "Contact info must be at most 200 characters",
      400,
      meta,
    );
  }
}

export interface UpdateProfileRequest {
  readonly userId: UserId;
  readonly name?: string;
  readonly contactInfo?: string | null;
  readonly emailNotifications?: boolean;
}

export class UpdateProfileService {
  constructor(private readonly userRepository: UserRepository) {}

  async execute(input: UpdateProfileRequest): Promise<User> {
    // Build a mutable patch then freeze when handing off — keeps the
    // domain interface `readonly` while letting us assemble it in steps.
    const draft: {
      name?: string;
      contactInfo?: string | null;
      emailNotifications?: boolean;
    } = {};

    if (input.name !== undefined) {
      const normalized = input.name.normalize("NFC").trim();
      if (normalized.length === 0 || normalized.length > NAME_MAX) {
        throw new InvalidNameError({ length: normalized.length });
      }
      draft.name = normalized;
    }

    if (input.contactInfo !== undefined) {
      if (input.contactInfo === null) {
        draft.contactInfo = null;
      } else {
        const normalized = input.contactInfo.normalize("NFC").trim();
        if (normalized.length > CONTACT_INFO_MAX) {
          throw new ContactInfoTooLongError({ length: normalized.length });
        }
        // Empty after trim → store as NULL (explicit clear), so the
        // profile renders without the section.
        draft.contactInfo = normalized.length === 0 ? null : normalized;
      }
    }

    if (input.emailNotifications !== undefined) {
      draft.emailNotifications = input.emailNotifications;
    }

    return this.userRepository.updateProfile(
      input.userId,
      draft as UpdateProfileInput,
    );
  }
}
