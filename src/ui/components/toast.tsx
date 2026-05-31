/**
 * MODULE: ui.components.toast
 * PURPOSE: App-wide toast system — the canonical replacement for `window.alert`
 *          across the app (spec uses transient toasts for success / error / info
 *          feedback, e.g. "Link copied", "Request cancelled", "A spot just
 *          opened — refresh to join"). A `ToastProvider` holds the live toast
 *          queue + exposes `useToast().toast(message, tone)`; a fixed `Toaster`
 *          renders the stack above the BottomNav and auto-dismisses each item.
 * LAYER: ui (client)
 * DEPENDENCIES: react, src/ui/lib/cn
 * CONSUMED BY: app/app-providers.tsx (mounted once in the root layout); any
 *              client component via `useToast()`.
 * INVARIANTS:
 *   - One provider for the whole tree (mounted in app/app-providers). `useToast`
 *     throws if called outside it — a missing provider is a wiring bug, not a
 *     silent no-op.
 *   - Toasts auto-dismiss after DURATION_MS; tapping one dismisses it early.
 *   - The Toaster is `pointer-events-none` except for the toast pills, so it
 *     never blocks taps on the page beneath it.
 * RELATED DOCS: docs/spec/pitchup-spec-match.md / global.md — toast strings.
 */
"use client";

import {
  createContext,
  useCallback,
  useContext,
  useState,
  type ReactNode,
} from "react";

import { cn } from "@/src/ui/lib/cn";

export type ToastTone = "default" | "success" | "error";

interface ToastItem {
  readonly id: number;
  readonly message: string;
  readonly tone: ToastTone;
}

interface ToastContextValue {
  /** Show a transient toast. `tone` styles it (default / success / error). */
  toast: (message: string, tone?: ToastTone) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    throw new Error("useToast must be used within <ToastProvider>");
  }
  return ctx;
}

const DURATION_MS = 4000;
let nextId = 1;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<readonly ToastItem[]>([]);

  const dismiss = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const toast = useCallback(
    (message: string, tone: ToastTone = "default") => {
      const id = nextId++;
      setToasts((prev) => [...prev, { id, message, tone }]);
      setTimeout(() => dismiss(id), DURATION_MS);
    },
    [dismiss],
  );

  return (
    <ToastContext.Provider value={{ toast }}>
      {children}
      <Toaster toasts={toasts} onDismiss={dismiss} />
    </ToastContext.Provider>
  );
}

const TONE_CLASS: Record<ToastTone, string> = {
  default: "bg-text-primary text-text-inverted",
  success: "bg-green-dark text-text-inverted",
  error: "bg-destructive text-text-inverted",
};

function Toaster({
  toasts,
  onDismiss,
}: {
  toasts: readonly ToastItem[];
  onDismiss: (id: number) => void;
}) {
  if (toasts.length === 0) return null;

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-24 z-[60] mx-auto flex w-full max-w-[375px] flex-col items-center gap-2 px-4">
      {toasts.map((t) => (
        <button
          key={t.id}
          type="button"
          onClick={() => onDismiss(t.id)}
          className={cn(
            "pointer-events-auto w-full rounded-btn px-4 py-3 text-center text-[14px] font-medium shadow-card",
            TONE_CLASS[t.tone],
          )}
        >
          {t.message}
        </button>
      ))}
    </div>
  );
}
