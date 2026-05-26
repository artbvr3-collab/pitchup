/**
 * MODULE: app.matches.id.match-tabs
 * PURPOSE: Tab switcher `[ Lineup ] [ Chat ]`. Local state owned by the
 *          shell — this component only renders and emits clicks.
 * LAYER: interfaces (client; presentational)
 * RELATED DOCS: docs/spec/pitchup-spec-match.md → §55 ("Tab bar")
 */
"use client";

import { cn } from "@/src/ui/lib/cn";

export type TabId = "lineup" | "chat";

export interface MatchTabsProps {
  readonly activeTab: TabId;
  readonly onTabChange: (next: TabId) => void;
}

const TABS: ReadonlyArray<{ id: TabId; label: string }> = [
  { id: "lineup", label: "Lineup" },
  { id: "chat", label: "Chat" },
];

export function MatchTabs(props: MatchTabsProps) {
  return (
    <div className="flex border-b border-border" role="tablist">
      {TABS.map((tab) => (
        <button
          key={tab.id}
          type="button"
          role="tab"
          aria-selected={props.activeTab === tab.id}
          onClick={() => props.onTabChange(tab.id)}
          className={cn(
            "flex-1 py-3 text-sm font-semibold transition-colors",
            props.activeTab === tab.id
              ? "border-b-2 border-green-dark text-green-dark"
              : "text-text-secondary",
          )}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}
