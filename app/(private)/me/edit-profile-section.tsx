/**
 * MODULE: app.(private).me.edit-profile-section
 * PURPOSE: Client island that owns the inline "Edit profile" form on /me.
 *          Two visual states:
 *            - Display: name + contact info (or "Add contact info" hint),
 *              with an `[Edit]` link in the section header.
 *            - Edit: two inputs (name + contactInfo) with Save / Cancel.
 *          Saving posts via `updateProfileAction` Server Action and
 *          shows a field-level error on `{ ok: false }`. Cancel reverts
 *          to the initial values.
 * LAYER: interfaces (client component)
 * DEPENDENCIES: ./actions → updateProfileAction
 * INVARIANTS:
 *   - The initial values come from the server-rendered page via props;
 *     after a successful save the Server Action revalidates `/me` so the
 *     RSC re-runs and re-seeds this island via the same prop path.
 *   - Char counter mirrors backend caps: 100 for name, 200 for contactInfo.
 *     Submit button is disabled when either input violates the cap (UX
 *     mirror — backend is still the source of truth).
 *   - No `localStorage` — drafts disappear on cancel / page reload. Edit
 *     in /me is rarely interrupted; persistence isn't worth the complexity.
 * RELATED DOCS:
 *   - docs/spec/pitchup-spec-personal.md → "/me → Section ACCOUNT → Edit profile"
 *   - docs/spec/pitchup-spec-global.md → "Text field validation &
 *     sanitization" (name max 100 by convention; contactInfo max 200)
 */
"use client";

import { useState, useTransition } from "react";

import { cn } from "@/src/ui/lib/cn";

import { updateProfileAction } from "./actions";

const NAME_MAX = 100;
const CONTACT_INFO_MAX = 200;

export interface EditProfileSectionProps {
  readonly initialName: string;
  readonly initialContactInfo: string | null;
}

export function EditProfileSection({
  initialName,
  initialContactInfo,
}: EditProfileSectionProps) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(initialName);
  const [contactInfo, setContactInfo] = useState(initialContactInfo ?? "");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const nameTrimmed = name.trim();
  const nameTooLong = name.length > NAME_MAX;
  const contactTooLong = contactInfo.length > CONTACT_INFO_MAX;
  const canSave =
    !nameTooLong && !contactTooLong && nameTrimmed.length > 0 && !isPending;

  const cancel = () => {
    setName(initialName);
    setContactInfo(initialContactInfo ?? "");
    setError(null);
    setEditing(false);
  };

  const save = () => {
    setError(null);
    startTransition(async () => {
      const result = await updateProfileAction({
        name,
        contactInfo: contactInfo.length === 0 ? null : contactInfo,
      });
      if (result.ok) {
        setEditing(false);
      } else {
        setError(result.message);
      }
    });
  };

  if (!editing) {
    return (
      <div className="rounded-card bg-bg-card p-4 shadow-card">
        <div className="flex items-center justify-between">
          <div className="text-[13px] font-semibold uppercase tracking-[0.06em] text-text-secondary">
            Profile
          </div>
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="text-[13px] font-semibold text-green-dark hover:text-green-mid"
          >
            Edit
          </button>
        </div>
        <div className="mt-3">
          <div className="text-[15px] font-semibold text-text-primary">
            {initialName}
          </div>
          <div className="mt-1 text-[13px] text-text-secondary">
            {initialContactInfo && initialContactInfo.length > 0 ? (
              <span className="whitespace-pre-wrap">{initialContactInfo}</span>
            ) : (
              <span className="italic text-text-muted">
                No contact info — tap Edit to add
              </span>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-card bg-bg-card p-4 shadow-card">
      <div className="text-[13px] font-semibold uppercase tracking-[0.06em] text-text-secondary">
        Profile
      </div>

      <label className="mt-3 block text-[12px] font-medium text-text-secondary">
        Name
      </label>
      <input
        type="text"
        value={name}
        onChange={(e) => setName(e.target.value)}
        maxLength={NAME_MAX + 20 /* allow overflow for UI char-counter UX */}
        autoComplete="name"
        className={cn(
          "mt-1.5 h-11 w-full rounded-btn border bg-bg-card px-3 text-[15px] text-text-primary focus:outline-none",
          nameTooLong
            ? "border-status-full focus:border-status-full"
            : "border-border focus:border-border-focus",
        )}
      />
      <div className="mt-1 text-[11px] text-text-secondary">
        {name.length} / {NAME_MAX}
      </div>

      <label className="mt-4 block text-[12px] font-medium text-text-secondary">
        Contact info (optional)
      </label>
      <textarea
        value={contactInfo}
        onChange={(e) => setContactInfo(e.target.value)}
        rows={3}
        placeholder="WhatsApp +420..., Telegram @username, Instagram..."
        className={cn(
          "mt-1.5 w-full rounded-btn border bg-bg-card px-3 py-2 text-[14px] text-text-primary placeholder:text-text-muted focus:outline-none",
          contactTooLong
            ? "border-status-full focus:border-status-full"
            : "border-border focus:border-border-focus",
        )}
      />
      <div className="mt-1 text-[11px] text-text-secondary">
        {contactInfo.length} / {CONTACT_INFO_MAX}
      </div>

      {error && (
        <div className="mt-3 text-[12px] text-status-full">{error}</div>
      )}

      <div className="mt-4 flex gap-2">
        <button
          type="button"
          onClick={save}
          disabled={!canSave}
          className={cn(
            "inline-flex h-11 flex-1 items-center justify-center rounded-btn px-4 text-[14px] font-semibold transition-colors",
            canSave
              ? "bg-green-dark text-text-inverted shadow-btn hover:bg-green-mid"
              : "cursor-not-allowed bg-bg-card-dim text-text-muted",
          )}
        >
          {isPending ? "Saving…" : "Save"}
        </button>
        <button
          type="button"
          onClick={cancel}
          disabled={isPending}
          className="inline-flex h-11 items-center justify-center rounded-btn border border-border-strong bg-bg-card px-4 text-[14px] font-semibold text-text-primary hover:bg-bg-card-dim"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
