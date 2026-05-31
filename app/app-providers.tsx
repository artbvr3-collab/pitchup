/**
 * MODULE: app.app-providers
 * PURPOSE: Client-side provider stack mounted once in the root layout so any
 *          client component in the tree can use `useToast()` / `useConfirm()`.
 *          Keeps the (async, Server Component) root layout free of "use client".
 * LAYER: interfaces (client)
 * DEPENDENCIES: src/ui/components/toast, src/ui/components/confirm
 * CONSUMED BY: app/layout.tsx
 * RELATED DOCS: docs/ARCHITECTURE.md §11.
 */
"use client";

import type { ReactNode } from "react";

import { ConfirmProvider } from "@/src/ui/components/confirm";
import { ToastProvider } from "@/src/ui/components/toast";

export function AppProviders({ children }: { children: ReactNode }) {
  return (
    <ToastProvider>
      <ConfirmProvider>{children}</ConfirmProvider>
    </ToastProvider>
  );
}
