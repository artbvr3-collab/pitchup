/**
 * MODULE: auth.application.complete-onboarding-service
 * PURPOSE: Use case for "`[Get started →]` tapped on /welcome" — inserts the
 *          user row, idempotent on the parallel-tab race (delegated to the
 *          repository's `create`). The first and only DB write Layer 1 does.
 * LAYER: application
 * DEPENDENCIES: ../domain/user, ../domain/user-repository
 * CONSUMED BY: src/auth/composition.ts → app/(auth)/welcome/page.tsx (Etap E)
 * INVARIANTS:
 *   - Returns the existing row on conflict (idempotency: double-tap, parallel
 *     tabs). Never throws on the "row already exists" case.
 *   - `name` may differ from `profile.name` — the user can edit it on
 *     `/welcome` before submitting. `avatarUrl` is verbatim from Google.
 * RELATED DOCS: docs/spec/pitchup-spec-global.md "/welcome → After tapping
 *               [Get started →]".
 */
import { asGoogleSub, type User } from "../domain/user";
import type { UserRepository } from "../domain/user-repository";

export interface CompleteOnboardingInput {
  readonly googleSub: string;
  readonly email: string;
  readonly name: string;
  readonly avatarUrl: string;
}

export class CompleteOnboardingService {
  constructor(private readonly userRepository: UserRepository) {}

  async execute(input: CompleteOnboardingInput): Promise<User> {
    const googleSub = asGoogleSub(input.googleSub);
    const existing = await this.userRepository.findByGoogleSub(googleSub);
    if (existing) return existing;
    return this.userRepository.create({
      googleSub,
      email: input.email,
      name: input.name,
      avatarUrl: input.avatarUrl,
    });
  }
}
