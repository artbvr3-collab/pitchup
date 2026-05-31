/**
 * MODULE: app.matches.id.like-modal
 * PURPOSE: Post-match "Like teammates" modal (Layer 6.X). Shows the roster
 *          (captain + accepted players) minus the viewer, with a 👍 button on
 *          each. A like is irreversible and idempotent; once placed the row
 *          flips to "Liked ✓". On `404 target_not_found` the row redraws as
 *          `[Removed user]` (no button) + a toast.
 * LAYER: interfaces (client)
 * DEPENDENCIES: src/ui/components/modal, src/ui/components/toast, react
 * CONSUMED BY: app/matches/[id]/match-shell.tsx
 * INVARIANTS:
 *   - Self is filtered out (the spec: "the roster, excluding self"). Crew
 *     stubs are NOT shown — they have no User row and cannot be liked.
 *   - Each tap POSTs `{ target_id }` to `/api/matches/:id/likes`. 200 (whether
 *     freshly inserted or already existed) flips the row to liked and calls
 *     `onLiked(receiverId)` so the parent bumps the Lineup "👍 N" immediately.
 *   - 404 → mark the row removed, toast "This player is no longer available."
 *     Other errors → generic toast, row stays likeable for a retry.
 *   - Likes already placed before opening (from the lineup snapshot's
 *     `liked_by_viewer`) render as "Liked ✓" from the start.
 * RELATED DOCS:
 *   - docs/spec/pitchup-spec-match.md → "Post-match likes",
 *     "Race & idempotency" → "Like + target deleted/banned"
 */
"use client";

import { useMemo, useState } from "react";

import type { MatchStateLineup } from "@/src/match_lifecycle/application/dto/match-state";
import { Modal } from "@/src/ui/components/modal";
import { useToast } from "@/src/ui/components/toast";
import { cn } from "@/src/ui/lib/cn";

export interface LikeModalProps {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly matchId: string;
  readonly lineup: MatchStateLineup;
  readonly viewerId: string | null;
  /** Called after a successful like so the parent bumps the Lineup counter. */
  readonly onLiked: (receiverId: string) => void;
}

interface RosterMember {
  readonly id: string;
  readonly name: string;
  readonly banned: boolean;
  readonly likedInitially: boolean;
  readonly isCaptain: boolean;
}

export function LikeModal(props: LikeModalProps) {
  const { toast } = useToast();
  // Receiver ids liked during this modal session (in addition to the
  // snapshot's `liked_by_viewer`).
  const [likedNow, setLikedNow] = useState<ReadonlySet<string>>(new Set());
  // Receiver ids that returned 404 (banned/deleted between load and tap).
  const [removed, setRemoved] = useState<ReadonlySet<string>>(new Set());
  const [busyId, setBusyId] = useState<string | null>(null);

  const members = useMemo<RosterMember[]>(() => {
    const out: RosterMember[] = [];
    const { captain, captain_liked_by_viewer, accepted } = props.lineup;
    if (captain.id !== props.viewerId) {
      out.push({
        id: captain.id,
        name: captain.name,
        banned: captain.banned,
        likedInitially: captain_liked_by_viewer,
        isCaptain: true,
      });
    }
    for (const p of accepted) {
      if (p.user.id === props.viewerId) continue;
      out.push({
        id: p.user.id,
        name: p.user.name,
        banned: p.user.banned,
        likedInitially: p.liked_by_viewer,
        isCaptain: false,
      });
    }
    return out;
  }, [props.lineup, props.viewerId]);

  const like = async (receiverId: string) => {
    if (busyId) return;
    setBusyId(receiverId);
    try {
      const res = await fetch(`/api/matches/${props.matchId}/likes`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ target_id: receiverId }),
      });
      if (res.ok) {
        setLikedNow((prev) => new Set(prev).add(receiverId));
        props.onLiked(receiverId);
        return;
      }
      if (res.status === 404) {
        setRemoved((prev) => new Set(prev).add(receiverId));
        toast("This player is no longer available.", "error");
        return;
      }
      toast("Couldn't like this player. Try again.", "error");
    } catch {
      toast("Couldn't reach the server. Try again.", "error");
    } finally {
      setBusyId(null);
    }
  };

  return (
    <Modal open={props.open} onClose={props.onClose} ariaLabel="Like teammates">
      <div className="flex flex-col gap-4">
        <div>
          <h2 className="text-[17px] font-bold text-text-primary">
            Like your teammates
          </h2>
          <p className="mt-1 text-[13px] text-text-secondary">
            Likes are permanent and cannot be undone.
          </p>
        </div>

        <div className="flex max-h-[50vh] flex-col gap-2 overflow-y-auto">
          {members.length === 0 ? (
            <p className="py-6 text-center text-[14px] text-text-muted">
              No teammates to like.
            </p>
          ) : (
            members.map((m) => {
              const isRemoved = m.banned || removed.has(m.id);
              const isLiked = m.likedInitially || likedNow.has(m.id);
              return (
                <div
                  key={m.id}
                  className="flex items-center gap-2 rounded-card border border-border-soft bg-bg-card px-3 py-2"
                >
                  <span className="flex-1 text-[14px] font-medium text-text-primary">
                    {isRemoved ? "[Removed user]" : shortName(m.name)}
                    {m.isCaptain && !isRemoved ? (
                      <span className="ml-2 rounded-badge bg-lime px-1.5 py-0.5 text-[10px] font-bold text-lime-text">
                        Cap
                      </span>
                    ) : null}
                  </span>
                  {isRemoved ? null : isLiked ? (
                    <span className="text-[13px] font-semibold text-green-dark">
                      Liked ✓
                    </span>
                  ) : (
                    <button
                      type="button"
                      onClick={() => like(m.id)}
                      disabled={busyId !== null}
                      className={cn(
                        "rounded-full bg-lime px-3 py-1 text-[13px] font-semibold text-lime-text hover:brightness-95 disabled:opacity-50",
                      )}
                    >
                      👍 Like
                    </button>
                  )}
                </div>
              );
            })
          )}
        </div>

        <button
          type="button"
          onClick={props.onClose}
          className="h-11 rounded-btn bg-bg-card-dim text-[14px] font-semibold text-text-primary hover:bg-bg-card"
        >
          Done
        </button>
      </div>
    </Modal>
  );
}

function shortName(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return name;
  if (parts.length === 1) return parts[0]!;
  return `${parts[0]} ${parts[1]![0]!}.`;
}
