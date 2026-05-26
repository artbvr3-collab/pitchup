/**
 * MODULE: app.(public).games.filter-bar
 * PURPOSE: Sticky top bar above the day picker — venue search + `[⚙]` sheet
 *          trigger + `[+ New match]` link. The search field is intentionally
 *          ephemeral (spec: "search string is not written to the URL, lost on
 *          tab switch") — it's lifted into the parent shell and triggers a
 *          client-side fetch.
 * LAYER: interfaces (client island)
 * DEPENDENCIES: src/ui/components/*
 * INVARIANTS:
 *   - Search input only fires `onSearchChange` after a 250ms debounce — no
 *     per-keystroke fetch spam.
 *   - `[⚙]` shows a small accent dot in the top-right corner iff at least
 *     one sheet filter is currently applied (badge count is not shown — spec
 *     just specifies a dot).
 * RELATED DOCS: docs/spec/pitchup-spec-discovery.md → "/games" → "Sticky
 *               filter bar".
 */
"use client";

import Link from "next/link";
import * as React from "react";

import { Input } from "@/src/ui/components/input";
import { cn } from "@/src/ui/lib/cn";

export interface FilterBarProps {
  readonly initialSearch: string;
  readonly hasActiveFilters: boolean;
  readonly onSearchChange: (q: string) => void;
  readonly onOpenFilters: () => void;
}

const DEBOUNCE_MS = 250;

export function FilterBar(props: FilterBarProps) {
  const [value, setValue] = React.useState(props.initialSearch);
  const debounceRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  React.useEffect(() => () => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
  }, []);

  const handleChange = (next: string): void => {
    setValue(next);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      props.onSearchChange(next.trim());
    }, DEBOUNCE_MS);
  };

  return (
    <div className="flex items-center gap-2 bg-bg-base px-4 py-3">
      <div className="flex-1">
        <Input
          type="search"
          inputMode="search"
          placeholder="🔍 Search venue..."
          value={value}
          onChange={(e) => handleChange(e.target.value)}
          aria-label="Search venue"
        />
      </div>
      <button
        type="button"
        onClick={props.onOpenFilters}
        aria-label="More filters"
        className={cn(
          "relative inline-flex h-[42px] w-[42px] shrink-0 items-center justify-center rounded-[10px] border border-border bg-bg-card text-[18px] text-text-primary",
        )}
      >
        ⚙
        {props.hasActiveFilters && (
          <span
            aria-hidden="true"
            className="absolute right-1.5 top-1.5 h-2 w-2 rounded-full bg-status-almost"
          />
        )}
      </button>
      <Link
        href="/matches/new"
        className="inline-flex h-[42px] shrink-0 items-center justify-center rounded-[10px] bg-green-dark px-3 text-[13px] font-semibold text-text-inverted shadow-btn"
      >
        + New match
      </Link>
    </div>
  );
}
