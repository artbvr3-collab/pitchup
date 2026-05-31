/**
 * MODULE: ui.components.confirm
 * PURPOSE: Imperative confirmation dialog — the canonical replacement for
 *          `window.confirm`. `useConfirm()` returns an async function that
 *          opens a centered Modal and resolves `true`/`false` when the user
 *          confirms or cancels. Lets call sites keep their straight-line
 *          `if (!(await confirm({...}))) return;` flow (mis-tap protection)
 *          without bespoke modal state.
 * LAYER: ui (client)
 * DEPENDENCIES: react, ./modal, ./button
 * CONSUMED BY: app/app-providers.tsx (mounted once); any client component via
 *              `useConfirm()` — Kick, Delete message, Cancel request, Discard
 *              wizard, etc.
 * INVARIANTS:
 *   - One provider for the whole tree. `useConfirm` throws outside it.
 *   - Backdrop / Esc / Cancel all resolve `false`; only the confirm button
 *     resolves `true`. A pending promise is always resolved exactly once.
 *   - `tone: "destructive"` renders a solid red confirm button (Kick / Delete).
 * RELATED DOCS: src/ui/components/modal.tsx.
 */
"use client";

import {
  createContext,
  useCallback,
  useContext,
  useRef,
  useState,
  type ReactNode,
} from "react";

import { Button } from "./button";
import { Modal } from "./modal";

export interface ConfirmOptions {
  readonly title: string;
  readonly body?: string;
  readonly confirmLabel?: string;
  readonly cancelLabel?: string;
  readonly tone?: "default" | "destructive";
}

type ConfirmFn = (opts: ConfirmOptions) => Promise<boolean>;

const ConfirmContext = createContext<ConfirmFn | null>(null);

export function useConfirm(): ConfirmFn {
  const ctx = useContext(ConfirmContext);
  if (!ctx) {
    throw new Error("useConfirm must be used within <ConfirmProvider>");
  }
  return ctx;
}

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [options, setOptions] = useState<ConfirmOptions | null>(null);
  const resolverRef = useRef<((value: boolean) => void) | null>(null);

  const confirm = useCallback<ConfirmFn>((opts) => {
    return new Promise<boolean>((resolve) => {
      resolverRef.current = resolve;
      setOptions(opts);
    });
  }, []);

  const settle = useCallback((value: boolean) => {
    setOptions(null);
    const resolve = resolverRef.current;
    resolverRef.current = null;
    resolve?.(value);
  }, []);

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      <Modal
        open={options !== null}
        onClose={() => settle(false)}
        ariaLabel={options?.title ?? "Confirm"}
      >
        {options && (
          <div className="flex flex-col gap-4">
            <div>
              <h2 className="text-[17px] font-bold leading-tight text-text-primary">
                {options.title}
              </h2>
              {options.body && (
                <p className="mt-1.5 text-[14px] text-text-secondary">
                  {options.body}
                </p>
              )}
            </div>
            <div className="flex gap-2">
              <Button
                variant="ghost"
                className="flex-1"
                onClick={() => settle(false)}
              >
                {options.cancelLabel ?? "Cancel"}
              </Button>
              <Button
                variant={
                  options.tone === "destructive" ? "destructive" : "primary"
                }
                className="flex-1"
                onClick={() => settle(true)}
              >
                {options.confirmLabel ?? "Confirm"}
              </Button>
            </div>
          </div>
        )}
      </Modal>
    </ConfirmContext.Provider>
  );
}
