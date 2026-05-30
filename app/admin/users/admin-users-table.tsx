/**
 * MODULE: app.admin.users.admin-users-table
 * PURPOSE: The `/admin/users` table + row actions (Ban/Unban, Promote/Demote).
 *          Client island: renders the server-fetched rows, owns the
 *          reason-modal state, POSTs to `/api/admin/users/:id/:action`, and
 *          `router.refresh()`es on success. UI mirrors the spec's guards
 *          (self-row + last-admin disabled buttons + tooltips); the server is
 *          the source of truth (the handlers re-check).
 * LAYER: interfaces (client island)
 * DEPENDENCIES: next/navigation, src/ui/components/{button, sheet}, cn
 * CONSUMED BY: app/admin/users/page.tsx
 * INVARIANTS:
 *   - Self row (`id === currentAdminId`) disables `[Ban]` + `[Demote]` —
 *     tooltip "You cannot modify your own account" (spec → Self-modification
 *     guard). `[Promote]` is never shown on the self row (self is an admin).
 *   - Sole active admin (`isAdmin && !banned && activeAdminCount === 1`)
 *     disables `[Demote]` + `[Ban]` — tooltip "Last admin — cannot be demoted
 *     or banned" (spec → Last-admin guard). These are UX mirrors; the API
 *     re-checks and returns 403 `self_modification` / 409 `last_admin`.
 *   - Ban / Promote / Demote open a required-reason modal; Unban posts
 *     directly (no modal — spec).
 * RELATED DOCS: docs/spec/pitchup-spec-personal.md → "/admin/users".
 */
"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button } from "@/src/ui/components/button";
import { Sheet } from "@/src/ui/components/sheet";

export interface AdminUserRow {
  readonly id: string;
  readonly name: string;
  readonly email: string;
  readonly avatarUrl: string;
  readonly joinedLabel: string;
  readonly isAdmin: boolean;
  readonly banned: boolean;
}

type ReasonAction = "ban" | "promote" | "demote";

interface ModalState {
  readonly action: ReasonAction;
  readonly user: AdminUserRow;
}

const MODAL_COPY: Record<
  ReasonAction,
  { title: string; confirm: string; variant: "primary" | "destructive-ghost" }
> = {
  ban: { title: "Ban user", confirm: "Confirm ban", variant: "destructive-ghost" },
  promote: { title: "Promote to admin", confirm: "Confirm promote", variant: "primary" },
  demote: { title: "Demote to user", confirm: "Confirm demote", variant: "primary" },
};

const ERROR_MESSAGES: Record<string, string> = {
  self_modification: "You cannot modify your own account.",
  last_admin: "Cannot remove the last remaining admin.",
  user_not_found: "User not found.",
  validation_failed: "A reason is required.",
  admin_required: "You no longer have admin rights.",
  forbidden: "You no longer have admin rights.",
};

function messageForCode(code: string | undefined): string {
  return (code && ERROR_MESSAGES[code]) ?? "Something went wrong. Try again.";
}

export interface AdminUsersTableProps {
  readonly rows: readonly AdminUserRow[];
  readonly currentAdminId: string;
  readonly activeAdminCount: number;
}

export function AdminUsersTable({
  rows,
  currentAdminId,
  activeAdminCount,
}: AdminUsersTableProps) {
  const router = useRouter();
  const [modal, setModal] = useState<ModalState | null>(null);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);

  async function post(
    userId: string,
    action: "ban" | "unban" | "promote" | "demote",
    body?: Record<string, unknown>,
  ): Promise<void> {
    const res = await fetch(`/api/admin/users/${userId}/${action}`, {
      method: "POST",
      ...(body
        ? { headers: { "content-type": "application/json" }, body: JSON.stringify(body) }
        : {}),
    });
    if (!res.ok) {
      const data = (await res.json().catch(() => ({}))) as { code?: string };
      throw new Error(messageForCode(data.code));
    }
  }

  async function onUnban(user: AdminUserRow): Promise<void> {
    setPendingId(user.id);
    try {
      await post(user.id, "unban");
      router.refresh();
    } catch (err) {
      window.alert(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setPendingId(null);
    }
  }

  function openModal(action: ReasonAction, user: AdminUserRow): void {
    setModal({ action, user });
    setReason("");
    setError(null);
  }

  async function confirmModal(): Promise<void> {
    if (!modal) return;
    if (reason.trim().length === 0) {
      setError("A reason is required.");
      return;
    }
    setPendingId(modal.user.id);
    setError(null);
    try {
      await post(modal.user.id, modal.action, { reason: reason.trim() });
      setModal(null);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setPendingId(null);
    }
  }

  return (
    <>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[640px] border-collapse text-[13px]">
          <thead>
            <tr className="border-b border-border text-left text-[11px] uppercase tracking-wide text-text-muted">
              <th className="px-3 py-2 font-medium">User</th>
              <th className="px-3 py-2 font-medium">Joined</th>
              <th className="px-3 py-2 font-medium">Admin</th>
              <th className="px-3 py-2 font-medium">Status</th>
              <th className="px-3 py-2 font-medium">Actions</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-3 py-6 text-center text-text-muted">
                  No records yet
                </td>
              </tr>
            ) : (
              rows.map((u) => {
                const isSelf = u.id === currentAdminId;
                const isSoleAdmin =
                  u.isAdmin && !u.banned && activeAdminCount === 1;
                const lockReason = isSelf
                  ? "You cannot modify your own account"
                  : isSoleAdmin
                    ? "Last admin — cannot be demoted or banned"
                    : undefined;
                const banDisabled =
                  pendingId === u.id || isSelf || isSoleAdmin;
                const demoteDisabled =
                  pendingId === u.id || isSelf || isSoleAdmin;

                return (
                  <tr key={u.id} className="border-b border-border align-middle">
                    <td className="px-3 py-2">
                      <div className="flex items-center gap-2">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={u.avatarUrl}
                          alt=""
                          className="h-7 w-7 shrink-0 rounded-full bg-bg-surface object-cover"
                        />
                        <div className="min-w-0">
                          <div className="truncate font-medium">
                            {u.name}
                            {isSelf && (
                              <span className="ml-1 text-text-muted">(you)</span>
                            )}
                          </div>
                          <div className="truncate text-[11px] text-text-muted">
                            {u.email}
                          </div>
                        </div>
                      </div>
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 text-text-secondary">
                      {u.joinedLabel}
                    </td>
                    <td className="px-3 py-2 text-center">
                      {u.isAdmin ? "✓" : ""}
                    </td>
                    <td className="px-3 py-2">
                      <span
                        className={
                          u.banned ? "text-destructive" : "text-text-secondary"
                        }
                      >
                        {u.banned ? "Banned" : "Active"}
                      </span>
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex w-max gap-1.5">
                        {u.banned ? (
                          <ActionButton
                            label="Unban"
                            onClick={() => onUnban(u)}
                            disabled={pendingId === u.id}
                          />
                        ) : (
                          <ActionButton
                            label="Ban"
                            variant="destructive-ghost"
                            onClick={() => openModal("ban", u)}
                            disabled={banDisabled}
                            title={banDisabled ? lockReason : undefined}
                          />
                        )}
                        {u.isAdmin ? (
                          <ActionButton
                            label="Demote"
                            onClick={() => openModal("demote", u)}
                            disabled={demoteDisabled}
                            title={demoteDisabled ? lockReason : undefined}
                          />
                        ) : (
                          <ActionButton
                            label="Promote"
                            onClick={() => openModal("promote", u)}
                            disabled={pendingId === u.id}
                          />
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      <Sheet
        open={modal !== null}
        onClose={() => setModal(null)}
        ariaLabel={modal ? MODAL_COPY[modal.action].title : "Action"}
      >
        {modal && (
          <div className="flex flex-col gap-3 p-4">
            <h2 className="text-[17px] font-bold">
              {MODAL_COPY[modal.action].title}
            </h2>
            <p className="text-[13px] text-text-secondary">
              {modal.user.name} · {modal.user.email}
            </p>
            <textarea
              autoFocus
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Reason (required)"
              rows={3}
              maxLength={1000}
              className="w-full resize-none rounded-lg border-[1.5px] border-border bg-bg-card p-2.5 text-[14px] outline-none focus:border-green-dark"
            />
            {error && <p className="text-[13px] text-destructive">{error}</p>}
            <div className="flex gap-2">
              <Button
                variant="ghost"
                onClick={() => setModal(null)}
                disabled={pendingId === modal.user.id}
              >
                Cancel
              </Button>
              <Button
                variant={MODAL_COPY[modal.action].variant}
                onClick={confirmModal}
                disabled={pendingId === modal.user.id}
              >
                {MODAL_COPY[modal.action].confirm}
              </Button>
            </div>
          </div>
        )}
      </Sheet>
    </>
  );
}

function ActionButton({
  label,
  onClick,
  disabled,
  title,
  variant = "ghost",
}: {
  readonly label: string;
  readonly onClick: () => void;
  readonly disabled?: boolean;
  readonly title?: string | undefined;
  readonly variant?: "ghost" | "destructive-ghost";
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={
        "h-8 whitespace-nowrap rounded-lg border-[1.5px] px-2.5 text-[12px] font-medium transition-opacity disabled:cursor-not-allowed disabled:opacity-40 " +
        (variant === "destructive-ghost"
          ? "border-[#FECACA] text-destructive hover:bg-destructive-bg"
          : "border-border text-text-primary hover:bg-bg-surface")
      }
    >
      {label}
    </button>
  );
}
