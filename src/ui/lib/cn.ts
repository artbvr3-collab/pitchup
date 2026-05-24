/**
 * MODULE: ui.lib.cn
 * PURPOSE: Merge Tailwind class strings with conflict resolution.
 * LAYER: ui
 * DEPENDENCIES: clsx, tailwind-merge.
 */
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
