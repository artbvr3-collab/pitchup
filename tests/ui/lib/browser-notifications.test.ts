/**
 * MODULE: tests.ui.lib.browser-notifications
 * PURPOSE: Cover the pure helpers — iOS UA detection and the §340 mount
 *          re-sync state machine. The window-touching helpers (flag read/write,
 *          fire) are exercised manually in the browser.
 * LAYER: tests / ui (pure)
 * TESTS FOR: src/ui/lib/browser-notifications.ts
 * RELATED DOCS: docs/spec/pitchup-spec-global.md → "Browser notifications"
 */
import { describe, expect, it } from "vitest";

import {
  isIOS,
  resolveFlagOnMount,
} from "@/src/ui/lib/browser-notifications";

describe("isIOS", () => {
  const IOS_UAS = [
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15",
    "Mozilla/5.0 (iPad; CPU OS 16_0 like Mac OS X) AppleWebKit/605.1.15",
    "Mozilla/5.0 (iPod touch; CPU iPhone OS 15_0 like Mac OS X)",
    // Chrome on iOS still uses WKWebView → must be treated as iOS:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) CriOS/120.0",
  ];
  const NON_IOS_UAS = [
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/120",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120",
    "Mozilla/5.0 (Linux; Android 14; Pixel 8) Chrome/120 Mobile",
    "Mozilla/5.0 (X11; Linux x86_64) Firefox/121.0",
  ];

  for (const ua of IOS_UAS) {
    it(`detects iOS: ${ua.slice(0, 40)}…`, () => {
      expect(isIOS(ua)).toBe(true);
    });
  }
  for (const ua of NON_IOS_UAS) {
    it(`detects non-iOS: ${ua.slice(0, 40)}…`, () => {
      expect(isIOS(ua)).toBe(false);
    });
  }
});

describe("resolveFlagOnMount (spec §340)", () => {
  it("granted + stored true → stays true", () => {
    expect(resolveFlagOnMount("granted", true)).toBe(true);
  });
  it("granted + stored false → stays false (deliberate opt-out)", () => {
    expect(resolveFlagOnMount("granted", false)).toBe(false);
  });
  it("denied + stored true → forced off (blocked externally)", () => {
    expect(resolveFlagOnMount("denied", true)).toBe(false);
  });
  it("default + stored true → forced off (permission reset)", () => {
    expect(resolveFlagOnMount("default", true)).toBe(false);
  });
  it("denied + stored false → off", () => {
    expect(resolveFlagOnMount("denied", false)).toBe(false);
  });
});
