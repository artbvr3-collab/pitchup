/**
 * MODULE: app.(private).me.browser-notifications-toggle
 * PURPOSE: Client island for the "Browser notifications" row in /me's
 *          NOTIFICATIONS section (Layer 7b). Owns the WHOLE row so it can hide
 *          itself on iOS (where the Notification API doesn't deliver). On mount
 *          it reconciles the localStorage intent with the live browser
 *          permission (spec §340). Toggling on runs the permission prompt; the
 *          preference is stored in localStorage, never the DB (per-browser).
 * LAYER: interfaces (client component)
 * DEPENDENCIES: src/ui/components/switch, src/ui/lib/browser-notifications
 * INVARIANTS:
 *   - Renders a stable placeholder until mounted (server + first client render
 *     are identical → no hydration mismatch); then either the live row or
 *     null on iOS.
 *   - Enable flow: permission 'default' → prompt; 'granted' → on; 'denied' or
 *     dismissed → stays off + inline message (spec §338).
 *   - The actual firing of notifications lives in SignedInChrome (on poll);
 *     this component only manages the preference + permission.
 * RELATED DOCS:
 *   - docs/spec/pitchup-spec-global.md → "Browser notifications" (§334-346),
 *     docs/spec/pitchup-spec-personal.md → "/me → Section NOTIFICATIONS"
 */
"use client";

import { useEffect, useState } from "react";

import { Switch } from "@/src/ui/components/switch";
import {
  browserNotificationsSupported,
  readBrowserNotifFlag,
  resolveFlagOnMount,
  writeBrowserNotifFlag,
} from "@/src/ui/lib/browser-notifications";

type Phase = "loading" | "hidden" | "ready";

export function BrowserNotificationsToggle() {
  const [phase, setPhase] = useState<Phase>("loading");
  const [enabled, setEnabled] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    // iOS (or no Notification API) → hide the row entirely (spec §335).
    if (!browserNotificationsSupported(navigator.userAgent)) {
      setPhase("hidden");
      return;
    }
    // Reconcile stored intent with the live permission, then persist the
    // resolved value so an externally-revoked permission can't leave a stale
    // "on" in storage (spec §340).
    const resolved = resolveFlagOnMount(
      Notification.permission,
      readBrowserNotifFlag(),
    );
    writeBrowserNotifFlag(resolved);
    setEnabled(resolved);
    setPhase("ready");
  }, []);

  if (phase === "hidden") return null;

  if (phase === "loading") {
    return (
      <Row>
        <div
          className="h-6 w-11 animate-pulse rounded-full bg-bg-card-dim"
          aria-hidden
        />
      </Row>
    );
  }

  const handleChange = async (next: boolean) => {
    setMessage(null);
    if (!next) {
      setEnabled(false);
      writeBrowserNotifFlag(false);
      return;
    }

    // Turning ON — ensure permission.
    setBusy(true);
    try {
      let permission = Notification.permission;
      if (permission === "default") {
        permission = await Notification.requestPermission();
      }
      if (permission === "granted") {
        setEnabled(true);
        writeBrowserNotifFlag(true);
      } else {
        setEnabled(false);
        writeBrowserNotifFlag(false);
        setMessage(
          permission === "denied"
            ? "Notifications blocked. Allow them in your browser settings."
            : "Notification permission was dismissed.",
        );
      }
    } catch {
      setEnabled(false);
      writeBrowserNotifFlag(false);
      setMessage("Couldn't enable notifications.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Row message={message}>
      <Switch checked={enabled} onCheckedChange={handleChange} disabled={busy} />
    </Row>
  );
}

function Row({
  children,
  message,
}: {
  children: React.ReactNode;
  message?: string | null;
}) {
  return (
    <div className="rounded-card bg-bg-card p-4 shadow-card">
      <div className="flex items-start gap-3">
        <span className="text-[18px] leading-none" aria-hidden>
          🔔
        </span>
        <div className="min-w-0 flex-1">
          <div className="text-[15px] font-semibold text-text-primary">
            Browser notifications
          </div>
          <div className="mt-0.5 text-[12px] text-text-secondary">
            Get notified even when the tab is in the background.
          </div>
        </div>
        <div className="shrink-0">{children}</div>
      </div>
      {message && (
        <div className="mt-2 text-[11px] text-status-full">{message}</div>
      )}
    </div>
  );
}
