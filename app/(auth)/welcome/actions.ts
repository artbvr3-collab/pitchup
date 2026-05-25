/**
 * MODULE: app.(auth).welcome.actions
 * PURPOSE: Server Actions for the onboarding screen. Two actions:
 *          - `completeOnboardingAction(formData)` — validates the form,
 *            invokes `CompleteOnboardingService`, redirects to `callbackUrl`
 *            or `/my-matches`.
 *          - `signOutAction()` — Auth.js v5 sign-out, returns the user to
 *            `/login`. Allowed under ADR-0001 because the action originates
 *            on `/welcome` (one of the two routes exempted from "mutations
 *            via Route Handlers").
 * LAYER: interfaces
 * DEPENDENCIES: zod, next/navigation, src/auth/composition, src/shared/errors
 * RELATED DOCS: docs/spec/pitchup-spec-global.md "/welcome → After tapping
 *               [Get started →]", docs/adr/0001-rest-routes-over-server-actions.md.
 */
"use server";

import { redirect } from "next/navigation";
import { z } from "zod";

import { auth, signOut } from "@/src/auth/infrastructure/auth";
import { completeOnboardingService } from "@/src/auth/composition";
import { UnauthorizedError, ValidationError } from "@/src/shared/errors/app-error";

const OnboardingSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(100),
  callbackUrl: z
    .string()
    .optional()
    .transform((value) => (value && value.length > 0 ? value : undefined)),
});

function safeCallbackUrl(raw: string | undefined): string {
  if (!raw) return "/my-matches";
  if (!raw.startsWith("/") || raw.startsWith("//")) return "/my-matches";
  if (raw === "/login" || raw === "/welcome") return "/my-matches";
  return raw;
}

export async function completeOnboardingAction(formData: FormData): Promise<void> {
  const parsed = OnboardingSchema.safeParse({
    name: formData.get("name"),
    callbackUrl: formData.get("callbackUrl"),
  });
  if (!parsed.success) {
    throw new ValidationError({ fieldErrors: parsed.error.flatten().fieldErrors });
  }

  const session = await auth();
  if (!session?.googleSub || !session.user?.email) {
    throw new UnauthorizedError("no_session");
  }

  await completeOnboardingService.execute({
    googleSub: session.googleSub,
    email: session.user.email,
    name: parsed.data.name,
    avatarUrl: session.user.image ?? "",
  });

  redirect(safeCallbackUrl(parsed.data.callbackUrl));
}

export async function signOutAction(): Promise<void> {
  await signOut({ redirectTo: "/login" });
}
