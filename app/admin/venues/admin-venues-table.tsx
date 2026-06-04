/**
 * MODULE: app.admin.venues.admin-venues-table
 * PURPOSE: The `/admin/venues` table + the single Add/Edit modal form. Client
 *          island: renders server-fetched rows (name / address / surface(s) /
 *          status / Google Maps link + [Edit]), owns the form state, POSTs
 *          (create) / PATCHes (update) to `/api/admin/venues`, and
 *          `router.refresh()`es on success. The deactivation guard is mirrored
 *          here (toggle disabled + hint when the venue has upcoming matches);
 *          the API re-checks (409 backstop). The Photo field uploads to R2 via
 *          `POST /api/admin/venues/photo` (client-side downscale first) and
 *          falls back to a pasted URL; a Maps-URL → lat/lng one-tap helper fills
 *          the coordinate fields.
 * LAYER: interfaces (client island)
 * DEPENDENCIES: next/navigation, src/ui/components/{button, input, switch,
 *               sheet}, src/match_lifecycle/domain/covers,
 *               src/ui/lib/cover-style, POST /api/admin/venues/photo
 * CONSUMED BY: app/admin/venues/page.tsx
 * INVARIANTS:
 *   - One modal for both [+ Add venue] and [Edit] (spec — no inline cell edit).
 *   - Add omits `cover_id` when the picker is left on "Auto" → the server
 *     applies the deterministic-by-id default. Edit always sends `cover_id`.
 *   - Deactivation guard: when editing an `active` venue with
 *     `upcomingMatchCount > 0`, the Active toggle is disabled and the spec hint
 *     is shown; the toggle can't be flipped so Save can't deactivate it.
 *   - Surface must be a non-empty subset of {grass, hard} (Save disabled
 *     otherwise) — backend Zod re-checks.
 *   - Photo upload is best-effort: a 503 `photo_storage_unconfigured` (R2 unset)
 *     surfaces a "paste a URL instead" hint rather than blocking Save — the
 *     `photoUrl` string is what's persisted either way.
 * RELATED DOCS: docs/spec/pitchup-spec-personal.md → "/admin/venues".
 */
"use client";

import { MagnifyingGlass } from "@phosphor-icons/react";
import { useRouter } from "next/navigation";
import { useMemo, useRef, useState } from "react";

import { COVER_IDS } from "@/src/match_lifecycle/domain/covers";
import { Button } from "@/src/ui/components/button";
import { Input } from "@/src/ui/components/input";
import { Modal } from "@/src/ui/components/modal";
import { Switch } from "@/src/ui/components/switch";
import { coverBackground, coverIcon } from "@/src/ui/lib/cover-style";

export interface AdminVenueRow {
  readonly id: string;
  readonly name: string;
  readonly address: string;
  readonly lat: number;
  readonly lng: number;
  readonly googleMapsUrl: string | null;
  readonly photoUrl: string | null;
  readonly surface: readonly ("grass" | "hard")[];
  readonly coverId: string;
  readonly active: boolean;
  readonly upcomingMatchCount: number;
}

const SURFACE_LABELS: Record<"grass" | "hard", string> = {
  grass: "Grass",
  hard: "Hard surface",
};

const ERROR_MESSAGES: Record<string, string> = {
  validation_failed: "Please check the fields and try again.",
  venue_not_found: "Venue not found.",
  admin_required: "You no longer have admin rights.",
  forbidden: "You no longer have admin rights.",
};

const UPLOAD_ERRORS: Record<string, string> = {
  photo_storage_unconfigured: "Uploads aren't set up yet — paste a URL below instead.",
  photo_invalid_type: "Use a JPG, PNG, or WebP image.",
  photo_too_large: "Image is too large (max 5 MB).",
  photo_missing: "No file selected.",
  admin_required: "You no longer have admin rights.",
  forbidden: "You no longer have admin rights.",
};

/**
 * Pull lat/lng out of a pasted Google Maps URL so the admin doesn't hand-type
 * coordinates. Handles the `?query=`/`?q=lat,lng` form (what our importer
 * writes) and the `@lat,lng` map-centre form. Returns null if neither matches.
 */
function parseLatLng(url: string): { lat: number; lng: number } | null {
  const param = url.match(/[?&](?:query|q)=(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/);
  if (param) return { lat: Number(param[1]), lng: Number(param[2]) };
  const at = url.match(/@(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/);
  if (at) return { lat: Number(at[1]), lng: Number(at[2]) };
  return null;
}

/**
 * Downscale (max 1280px long edge) + re-encode to JPEG client-side before
 * upload, so phone photos don't ship as multi-MB originals and the server gets
 * a predictable type. Falls back to the raw file if canvas decoding fails.
 */
async function prepareUpload(file: File): Promise<Blob> {
  try {
    const bitmap = await createImageBitmap(file);
    const maxDim = 1280;
    const scale = Math.min(1, maxDim / Math.max(bitmap.width, bitmap.height));
    const w = Math.round(bitmap.width * scale);
    const h = Math.round(bitmap.height * scale);
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      bitmap.close();
      return file;
    }
    ctx.drawImage(bitmap, 0, 0, w, h);
    bitmap.close();
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob((b) => resolve(b), "image/jpeg", 0.85),
    );
    return blob ?? file;
  } catch {
    return file;
  }
}

interface FormState {
  name: string;
  address: string;
  lat: string;
  lng: string;
  grass: boolean;
  hard: boolean;
  /** `null` = "Auto" (only selectable when adding). */
  coverId: string | null;
  googleMapsUrl: string;
  photoUrl: string;
  active: boolean;
}

type ModalState =
  | { readonly mode: "add" }
  | { readonly mode: "edit"; readonly venue: AdminVenueRow };

function blankForm(): FormState {
  return {
    name: "",
    address: "",
    lat: "",
    lng: "",
    grass: false,
    hard: false,
    coverId: null,
    googleMapsUrl: "",
    photoUrl: "",
    active: true,
  };
}

function formFromVenue(v: AdminVenueRow): FormState {
  return {
    name: v.name,
    address: v.address,
    lat: String(v.lat),
    lng: String(v.lng),
    grass: v.surface.includes("grass"),
    hard: v.surface.includes("hard"),
    coverId: v.coverId,
    googleMapsUrl: v.googleMapsUrl ?? "",
    photoUrl: v.photoUrl ?? "",
    active: v.active,
  };
}

export function AdminVenuesTable({ rows }: { readonly rows: readonly AdminVenueRow[] }) {
  const router = useRouter();
  const [modal, setModal] = useState<ModalState | null>(null);
  const [form, setForm] = useState<FormState>(blankForm);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Client-side list controls (rows are already fully loaded — no refetch).
  const [query, setQuery] = useState("");
  const [missingPhotoOnly, setMissingPhotoOnly] = useState(false);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows.filter((v) => {
      if (missingPhotoOnly && v.photoUrl) return false;
      if (q && !v.name.toLowerCase().includes(q) && !v.address.toLowerCase().includes(q)) {
        return false;
      }
      return true;
    });
  }, [rows, query, missingPhotoOnly]);

  function openAdd(): void {
    setModal({ mode: "add" });
    setForm(blankForm());
    setError(null);
    setUploadError(null);
  }

  function openEdit(venue: AdminVenueRow): void {
    setModal({ mode: "edit", venue });
    setForm(formFromVenue(venue));
    setError(null);
    setUploadError(null);
  }

  function patch(partial: Partial<FormState>): void {
    setForm((f) => ({ ...f, ...partial }));
  }

  // Deactivation guard (UI mirror): editing an active venue that still has
  // upcoming matches → the toggle is locked on.
  const upcomingCount = modal?.mode === "edit" ? modal.venue.upcomingMatchCount : 0;
  const editingActiveWithUpcoming =
    modal?.mode === "edit" && modal.venue.active && upcomingCount > 0;

  const surfaceChosen = form.grass || form.hard;
  const latLngValid =
    form.lat.trim() !== "" &&
    form.lng.trim() !== "" &&
    Number.isFinite(Number(form.lat)) &&
    Number.isFinite(Number(form.lng));
  const canSave =
    !pending &&
    form.name.trim() !== "" &&
    form.address.trim() !== "" &&
    surfaceChosen &&
    latLngValid;

  async function save(): Promise<void> {
    if (!modal || !canSave) return;
    setPending(true);
    setError(null);

    const surface: ("grass" | "hard")[] = [];
    if (form.grass) surface.push("grass");
    if (form.hard) surface.push("hard");

    const base = {
      name: form.name.trim(),
      address: form.address.trim(),
      lat: Number(form.lat),
      lng: Number(form.lng),
      surface,
      google_maps_url: form.googleMapsUrl.trim() === "" ? null : form.googleMapsUrl.trim(),
      photo_url: form.photoUrl.trim() === "" ? null : form.photoUrl.trim(),
      active: form.active,
    };

    const editVenue = modal.mode === "edit" ? modal.venue : null;
    const url = editVenue ? `/api/admin/venues/${editVenue.id}` : "/api/admin/venues";
    // Edit always sends a cover (form prefilled); Add omits it on "Auto".
    const coverId = form.coverId ?? editVenue?.coverId ?? null;
    const body =
      coverId !== null ? { ...base, cover_id: coverId } : base;

    try {
      const res = await fetch(url, {
        method: editVenue ? "PATCH" : "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as {
          code?: string;
          meta?: { upcomingMatchCount?: number };
        };
        if (data.code === "venue_has_upcoming_matches") {
          const n = data.meta?.upcomingMatchCount ?? "some";
          setError(
            `Can't deactivate — ${n} upcoming match(es) on this venue. Cancel them first or wait until they end.`,
          );
        } else {
          setError(ERROR_MESSAGES[data.code ?? ""] ?? "Something went wrong. Try again.");
        }
        return;
      }
      setModal(null);
      router.refresh();
    } catch {
      setError("Something went wrong. Try again.");
    } finally {
      setPending(false);
    }
  }

  async function onPickFile(e: React.ChangeEvent<HTMLInputElement>): Promise<void> {
    const file = e.target.files?.[0];
    e.target.value = ""; // let the same file be re-picked after an error
    if (!file) return;
    setUploading(true);
    setUploadError(null);
    try {
      const blob = await prepareUpload(file);
      const fd = new FormData();
      fd.append("photo", blob, "venue.jpg");
      const res = await fetch("/api/admin/venues/photo", { method: "POST", body: fd });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { code?: string };
        setUploadError(UPLOAD_ERRORS[data.code ?? ""] ?? "Upload failed. Try again.");
        return;
      }
      const { url } = (await res.json()) as { url: string };
      patch({ photoUrl: url });
    } catch {
      setUploadError("Upload failed. Try again.");
    } finally {
      setUploading(false);
    }
  }

  // Offer a one-tap "use these coordinates" when the pasted Maps URL has them.
  const parsedCoords = parseLatLng(form.googleMapsUrl);

  return (
    <>
      <div className="flex flex-wrap items-center gap-2 px-4 pb-2">
        <div className="relative w-full max-w-xs">
          <MagnifyingGlass
            size={16}
            weight="bold"
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-text-muted"
          />
          <Input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search name or address…"
            className="h-9 pl-9 text-[13px]"
          />
        </div>
        <button
          type="button"
          onClick={() => setMissingPhotoOnly((v) => !v)}
          className={
            "h-9 rounded-lg border-[1.5px] px-3 text-[12px] font-medium transition-colors " +
            (missingPhotoOnly
              ? "border-green-dark bg-green-dark text-text-inverted"
              : "border-border text-text-primary hover:bg-bg-surface")
          }
        >
          No photo
        </button>
        <span className="text-[12px] text-text-muted">
          {filtered.length === rows.length
            ? `${rows.length} venues`
            : `${filtered.length} / ${rows.length}`}
        </span>
        <button
          type="button"
          onClick={openAdd}
          className="ml-auto h-9 rounded-lg bg-green-dark px-3 text-[13px] font-semibold text-text-inverted transition-opacity hover:opacity-90"
        >
          + Add venue
        </button>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[640px] border-collapse text-[13px]">
          <thead>
            <tr className="border-b border-border text-left text-[11px] uppercase tracking-wide text-text-muted">
              <th className="px-3 py-2 font-medium">Venue</th>
              <th className="px-3 py-2 font-medium">Surface</th>
              <th className="px-3 py-2 font-medium">Status</th>
              <th className="px-3 py-2 font-medium">Map</th>
              <th className="px-3 py-2 font-medium">Actions</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-3 py-6 text-center text-text-muted">
                  {rows.length === 0 ? "No venues yet" : "No venues match your filters"}
                </td>
              </tr>
            ) : (
              filtered.map((v) => (
                <tr key={v.id} className="border-b border-border align-middle">
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-2.5">
                      <span
                        className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-md text-[15px]"
                        style={v.photoUrl ? undefined : { background: coverBackground(v.coverId) }}
                        aria-hidden
                      >
                        {v.photoUrl ? (
                          // eslint-disable-next-line @next/next/no-img-element -- admin-only internal thumbnail; remote host varies, no next/image config
                          <img
                            src={v.photoUrl}
                            alt=""
                            className="h-full w-full object-cover"
                          />
                        ) : (
                          coverIcon(v.coverId)
                        )}
                      </span>
                      <div className="min-w-0">
                        <div className="truncate font-medium">{v.name}</div>
                        <div className="truncate text-[11px] text-text-muted">
                          {v.address}
                        </div>
                      </div>
                    </div>
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-text-secondary">
                    {v.surface.map((s) => SURFACE_LABELS[s]).join(", ")}
                  </td>
                  <td className="px-3 py-2">
                    <span className={v.active ? "text-text-secondary" : "text-text-muted"}>
                      {v.active ? "Active" : "Inactive"}
                    </span>
                  </td>
                  <td className="px-3 py-2">
                    {v.googleMapsUrl ? (
                      <a
                        href={v.googleMapsUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-green-dark underline"
                      >
                        Open
                      </a>
                    ) : (
                      <span className="text-text-muted">—</span>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    <button
                      type="button"
                      onClick={() => openEdit(v)}
                      className="h-8 whitespace-nowrap rounded-lg border-[1.5px] border-border px-2.5 text-[12px] font-medium text-text-primary transition-colors hover:bg-bg-surface"
                    >
                      Edit
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <Modal
        open={modal !== null}
        onClose={() => setModal(null)}
        ariaLabel={modal?.mode === "edit" ? "Edit venue" : "Add venue"}
        className="max-w-[720px] p-0"
      >
        {modal && (
          <div className="flex max-h-[88vh] flex-col">
            <div className="border-b border-border px-5 py-3.5">
              <h2 className="text-[17px] font-bold">
                {modal.mode === "edit" ? "Edit venue" : "Add venue"}
              </h2>
            </div>

            <div className="grid grid-cols-1 gap-x-6 gap-y-4 overflow-y-auto p-5 md:grid-cols-2">
              {/* Left column — the data fields. */}
              <div className="flex flex-col gap-3">
                <Field label="Name">
                  <Input
                    value={form.name}
                    onChange={(e) => patch({ name: e.target.value })}
                    maxLength={100}
                    placeholder="Strahov — Field 3"
                  />
                </Field>

                <Field label="Address">
                  <Input
                    value={form.address}
                    onChange={(e) => patch({ address: e.target.value })}
                    maxLength={200}
                    placeholder="Vaníčkova 2, 169 00 Praha 6"
                  />
                </Field>

                <div className="flex gap-2">
                  <Field label="Lat" className="flex-1">
                    <Input
                      type="number"
                      step="any"
                      value={form.lat}
                      onChange={(e) => patch({ lat: e.target.value })}
                      placeholder="50.0793"
                    />
                  </Field>
                  <Field label="Lng" className="flex-1">
                    <Input
                      type="number"
                      step="any"
                      value={form.lng}
                      onChange={(e) => patch({ lng: e.target.value })}
                      placeholder="14.3879"
                    />
                  </Field>
                </div>

                <Field label="Surface(s)">
                  <div className="flex gap-2">
                    {(["grass", "hard"] as const).map((s) => {
                      const on = s === "grass" ? form.grass : form.hard;
                      return (
                        <button
                          key={s}
                          type="button"
                          onClick={() =>
                            patch(s === "grass" ? { grass: !form.grass } : { hard: !form.hard })
                          }
                          className={
                            "h-9 rounded-lg border-[1.5px] px-3 text-[13px] font-medium transition-colors " +
                            (on
                              ? "border-green-dark bg-green-dark text-text-inverted"
                              : "border-border text-text-primary hover:bg-bg-surface")
                          }
                        >
                          {SURFACE_LABELS[s]}
                        </button>
                      );
                    })}
                  </div>
                </Field>

                <Field label="Google Maps URL">
                  <Input
                    type="url"
                    value={form.googleMapsUrl}
                    onChange={(e) => patch({ googleMapsUrl: e.target.value })}
                    placeholder="https://maps.google.com/..."
                  />
                  {parsedCoords && (
                    <button
                      type="button"
                      onClick={() =>
                        patch({
                          lat: String(parsedCoords.lat),
                          lng: String(parsedCoords.lng),
                        })
                      }
                      className="mt-1 self-start text-[12px] font-medium text-green-dark underline"
                    >
                      Use coordinates from this link ({parsedCoords.lat.toFixed(4)},{" "}
                      {parsedCoords.lng.toFixed(4)})
                    </button>
                  )}
                </Field>

                <div className="flex items-center justify-between rounded-lg border-[1.5px] border-border px-3 py-2">
                  <div className="min-w-0">
                    <div className="text-[14px] font-medium">Active</div>
                    {editingActiveWithUpcoming && (
                      <div className="mt-0.5 text-[11px] text-text-muted">
                        Can&apos;t deactivate — {upcomingCount} upcoming match(es) on this
                        venue. Cancel them first or wait until they end.
                      </div>
                    )}
                  </div>
                  <Switch
                    checked={form.active}
                    onCheckedChange={(v) => patch({ active: v })}
                    disabled={editingActiveWithUpcoming}
                    aria-label="Active"
                  />
                </div>
              </div>

              {/* Right column — the visual fields (photo + cover). */}
              <div className="flex flex-col gap-3">
                <div className="flex flex-col gap-1">
                  <span className="text-[12px] font-medium text-text-secondary">Photo</span>
                  <div className="flex flex-col gap-2">
                    {form.photoUrl.trim() !== "" ? (
                      <div className="relative">
                        {/* eslint-disable-next-line @next/next/no-img-element -- admin-only internal preview; remote host varies, no next/image config */}
                        <img
                          src={form.photoUrl}
                          alt="Venue"
                          className="h-44 w-full rounded-lg border border-border object-cover"
                        />
                        <button
                          type="button"
                          onClick={() => patch({ photoUrl: "" })}
                          className="absolute -right-2 -top-2 flex h-6 w-6 items-center justify-center rounded-full bg-text-primary text-[13px] leading-none text-text-inverted shadow"
                          aria-label="Remove photo"
                        >
                          ×
                        </button>
                      </div>
                    ) : (
                      <div className="flex h-44 w-full items-center justify-center rounded-lg border-[1.5px] border-dashed border-border text-[12px] text-text-muted">
                        No photo
                      </div>
                    )}

                    <div>
                      <button
                        type="button"
                        onClick={() => fileInputRef.current?.click()}
                        disabled={uploading}
                        className="h-9 rounded-lg border-[1.5px] border-border px-3 text-[13px] font-medium text-text-primary transition-colors hover:bg-bg-surface disabled:opacity-50"
                      >
                        {uploading
                          ? "Uploading…"
                          : form.photoUrl.trim() !== ""
                            ? "Replace photo"
                            : "Upload photo"}
                      </button>
                      <input
                        ref={fileInputRef}
                        type="file"
                        accept="image/jpeg,image/png,image/webp"
                        className="hidden"
                        onChange={onPickFile}
                      />
                    </div>

                    {uploadError && (
                      <p className="text-[12px] text-destructive">{uploadError}</p>
                    )}

                    <details className="text-[12px]">
                      <summary className="cursor-pointer text-text-muted">
                        or paste a URL
                      </summary>
                      <Input
                        type="url"
                        value={form.photoUrl}
                        onChange={(e) => patch({ photoUrl: e.target.value })}
                        placeholder="https://example.com/venue.jpg"
                        className="mt-1"
                      />
                    </details>
                  </div>
                </div>

                <Field label="Cover">
                  <div className="grid grid-cols-6 gap-1.5">
                    {modal.mode === "add" && (
                      <button
                        type="button"
                        onClick={() => patch({ coverId: null })}
                        title="Auto (by venue)"
                        className={
                          "flex aspect-square items-center justify-center rounded-md border-[1.5px] text-[10px] font-medium " +
                          (form.coverId === null
                            ? "border-green-dark text-green-dark"
                            : "border-border text-text-muted")
                        }
                      >
                        Auto
                      </button>
                    )}
                    {COVER_IDS.map((c) => (
                      <button
                        key={c}
                        type="button"
                        onClick={() => patch({ coverId: c })}
                        title={c}
                        style={{ background: coverBackground(c) }}
                        className={
                          "flex aspect-square items-center justify-center rounded-md text-[14px] ring-offset-2 transition-shadow " +
                          (form.coverId === c ? "ring-2 ring-green-dark" : "")
                        }
                        aria-label={`Cover ${c}`}
                      >
                        {coverIcon(c)}
                      </button>
                    ))}
                  </div>
                </Field>
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 border-t border-border px-5 py-3">
              {error && <p className="mr-auto text-[13px] text-destructive">{error}</p>}
              <Button variant="ghost" onClick={() => setModal(null)} disabled={pending}>
                Cancel
              </Button>
              <Button onClick={save} disabled={!canSave}>
                Save
              </Button>
            </div>
          </div>
        )}
      </Modal>
    </>
  );
}

function Field({
  label,
  children,
  className,
}: {
  readonly label: string;
  readonly children: React.ReactNode;
  readonly className?: string;
}) {
  return (
    <label className={"flex flex-col gap-1 " + (className ?? "")}>
      <span className="text-[12px] font-medium text-text-secondary">{label}</span>
      {children}
    </label>
  );
}
