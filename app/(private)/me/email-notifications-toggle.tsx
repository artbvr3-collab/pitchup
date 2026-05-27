/**
 * MODULE: app.(private).me.email-notifications-toggle
 * PURPOSE: Client island for the "Email notifications" Switch in /me's
 *          NOTIFICATIONS section. Toggling fires `updateProfileAction`
 *          immediately; on failure the switch reverts and shows a toast-
 *          style inline message. Optimistic UI keeps the toggle snappy.
 * LAYER: interfaces (client component)
 * DEPENDENCIES: ./actions → updateProfileAction, src/ui/components/switch
 * INVARIANTS:
 *   - The toggle reflects the server-side `emailNotifications` flag. On
 *     mount, it uses the initial server value; on every change it sends a
 *     single-field patch and shows a "Saving…" hint while the action runs.
 *   - No localStorage / cookie — the flag is a profile attribute, multi-
 *     device truth lives in DB.
 * RELATED DOCS:
 *   - docs/spec/pitchup-spec-personal.md → "/me → Section NOTIFICATIONS →
 *     Email notifications"
 */
"use client";

import { useState, useTransition } from "react";

import { Switch } from "@/src/ui/components/switch";

import { updateProfileAction } from "./actions";

export interface EmailNotificationsToggleProps {
  readonly initialEnabled: boolean;
}

export function EmailNotificationsToggle({
  initialEnabled,
}: EmailNotificationsToggleProps) {
  const [enabled, setEnabled] = useState(initialEnabled);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const handleChange = (next: boolean) => {
    setEnabled(next); // optimistic
    setError(null);
    startTransition(async () => {
      const result = await updateProfileAction({ emailNotifications: next });
      if (!result.ok) {
        setEnabled(!next); // revert
        setError(result.message);
      }
    });
  };

  return (
    <div>
      <Switch
        checked={enabled}
        onCheckedChange={handleChange}
        disabled={isPending}
      />
      {error && (
        <div className="mt-1 text-[11px] text-status-full">{error}</div>
      )}
    </div>
  );
}
