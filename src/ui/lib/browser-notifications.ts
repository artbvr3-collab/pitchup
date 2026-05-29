/**
 * MODULE: ui.lib.browser-notifications
 * PURPOSE: Client-only helpers for the third notification channel — the browser
 *          Notification API (Layer 7b). NO service worker, NO Web Push (that's
 *          v1.1 / PWA). The on/off preference lives in localStorage, NOT the DB
 *          (permission is per-browser, not per-account). Pure helpers
 *          (isIOS / resolveFlagOnMount) are unit-tested; the window-touching
 *          ones guard `typeof window`.
 * LAYER: ui (client)
 * DEPENDENCIES: none (DOM globals, guarded)
 * CONSUMED BY: app/(private)/me/browser-notifications-toggle.tsx,
 *              app/signed-in-chrome.tsx
 * INVARIANTS:
 *   - iOS is detected by USER AGENT, not feature detection: `Notification` may
 *     exist in iOS WKWebView but doesn't actually deliver, so the toggle is
 *     HIDDEN on iOS to avoid creating expectations (spec global.md →
 *     "Browser notifications"). All iOS browsers share WKWebView, so the device
 *     check is sufficient — don't check engine/brand.
 *   - The flag is the user's intent; `Notification.permission` is the browser's
 *     grant. `resolveFlagOnMount` reconciles them (spec §340): permission lost
 *     externally (denied/default) forces the flag off; granted leaves the
 *     stored intent untouched (a deliberate opt-out stays off).
 *   - Dedup across tabs is delegated to the browser via `tag: notif:{id}` —
 *     the same notification fired from two tabs collapses into one (spec §347).
 * RELATED DOCS:
 *   - docs/spec/pitchup-spec-global.md → "Browser notifications (Notification
 *     API)" (§334-347)
 */

/** localStorage key for the per-browser on/off intent. */
export const BROWSER_NOTIF_STORAGE_KEY = "pitchup.browser_notifications";

/**
 * iOS detection by User Agent. All iOS browsers (Safari, Chrome, Firefox, …)
 * use WKWebView and inherit the same Notification API limitations, so checking
 * the device is sufficient. Pure — takes the UA string for testability.
 */
export function isIOS(userAgent: string): boolean {
  return /iPhone|iPad|iPod/i.test(userAgent);
}

/** True when browser notifications can work here: not iOS, and the API exists. */
export function browserNotificationsSupported(userAgent: string): boolean {
  return (
    typeof window !== "undefined" &&
    "Notification" in window &&
    !isIOS(userAgent)
  );
}

/** Read the stored intent. Defaults to false (off) when absent / unavailable. */
export function readBrowserNotifFlag(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(BROWSER_NOTIF_STORAGE_KEY) === "true";
  } catch {
    return false;
  }
}

/** Persist the intent. Best-effort (private-mode localStorage may throw). */
export function writeBrowserNotifFlag(value: boolean): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(
      BROWSER_NOTIF_STORAGE_KEY,
      value ? "true" : "false",
    );
  } catch {
    // ignore — private mode / storage disabled
  }
}

/**
 * Reconcile the stored intent with the current browser permission on /me mount
 * (spec §340). Pure — closes the "permission removed externally → UI still on"
 * desync.
 *   - granted  → keep the stored flag (true stays on; false is a real opt-out)
 *   - denied   → force off (blocked in site settings)
 *   - default  → force off (permission was reset; next enable re-prompts)
 */
export function resolveFlagOnMount(
  permission: NotificationPermission,
  storedFlag: boolean,
): boolean {
  return permission === "granted" ? storedFlag : false;
}

export interface FireBrowserNotificationInput {
  readonly id: string;
  readonly title: string;
  readonly body: string;
  /** Invoked on click (after window.focus()). Typically navigate to the match. */
  readonly onClick?: (() => void) | undefined;
}

/**
 * Construct + show a browser notification. The caller MUST have already checked
 * `document.hidden`, the stored flag, and `Notification.permission === 'granted'`
 * (see SignedInChrome). Throws if the browser blocks construction (e.g.
 * permission revoked between checks) — the caller catches and flips the flag off
 * (spec §339). `tag: notif:{id}` lets the browser collapse duplicates across
 * tabs (spec §347).
 */
export function fireBrowserNotification(
  input: FireBrowserNotificationInput,
): void {
  const notification = new Notification(input.title, {
    body: input.body,
    tag: `notif:${input.id}`,
  });
  if (input.onClick) {
    notification.onclick = () => {
      window.focus();
      input.onClick?.();
      notification.close();
    };
  }
}
