/**
 * MODULE: app.(public).style-lab
 * PURPOSE: Throwaway design-comparison page. Renders the core UI kit
 *          (match card, bottom nav, CTAs, status pills, hero/empty state)
 *          in two candidate visual directions side-by-side so the design
 *          direction can be chosen by eye, not by description:
 *            A. Juicy turf  — evolve current cream/green/lime, Solar icons,
 *               gradients, softer/bigger shadows, real photo covers.
 *            B. Glass & glow — dark-green glassmorphism, neon-lime accents,
 *               glow shadows.
 *          NOT linked anywhere. Safe to delete once a direction is picked.
 *          Uses Solar (bold-duotone) icons via a trimmed offline subset.
 * LAYER: ui (scratch)
 * ROUTE: /style-lab (public, no auth)
 */
"use client";

import { addCollection, Icon } from "@iconify/react";
import * as React from "react";

import solarSubset from "./solar-subset.json";

// Register the trimmed Solar set once on the client (offline, ~18KB).
addCollection(solarSubset as Parameters<typeof addCollection>[0]);

/** Thin wrapper: a Solar bold-duotone icon. Duotone tones derive from
 *  `color` automatically (secondary layer is the same hue at low opacity). */
function S({
  name,
  size = 24,
  className,
  style,
}: {
  name: string;
  size?: number;
  className?: string;
  style?: React.CSSProperties;
}) {
  return (
    <Icon
      icon={`solar:${name}`}
      width={size}
      height={size}
      className={className}
      style={style}
    />
  );
}

const PHOTO =
  "https://images.unsplash.com/photo-1551958219-acbc608c6377?w=640&q=80";

// ── Shared content (same match, rendered two ways) ────────────────────
const MATCH = {
  venue: "Stadion Juliska",
  address: "Praha 6 · Dejvice",
  date: "Wed 4 Jun",
  time: "19:00",
  duration: "90 min",
  filled: 8,
  capacity: 10,
  free: 2,
  price: "120 Kč",
};

// ══════════════════════════════════════════════════════════════════════
//  A. JUICY TURF
// ══════════════════════════════════════════════════════════════════════
function DirectionA() {
  return (
    <section
      className="space-y-5 px-4 py-6"
      style={{ background: "#f5f0e8" }}
    >
      <Header
        tag="A"
        title="Juicy turf"
        subtitle="Та же айдентика, но сочнее: Solar-иконки, градиенты, мягкие тени, фото."
        tagBg="linear-gradient(135deg,#c5e63c,#a8c82e)"
        tagColor="#2d3a00"
      />

      {/* Hero / empty-state with big duotone icon */}
      <div
        className="flex items-center gap-4 rounded-[20px] p-5"
        style={{
          background:
            "linear-gradient(135deg, rgba(197,230,60,0.18), rgba(14,92,47,0.06))",
          boxShadow: "0 8px 24px rgba(14,92,47,0.12), 0 2px 6px rgba(0,0,0,0.04)",
        }}
      >
        <div
          className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl"
          style={{
            background: "linear-gradient(135deg,#176b38,#0e5c2f)",
            boxShadow: "0 6px 16px rgba(14,92,47,0.35)",
          }}
        >
          <S name="football-bold-duotone" size={30} style={{ color: "#c5e63c" }} />
        </div>
        <div>
          <div className="text-[15px] font-bold" style={{ color: "#0e5c2f" }}>
            3 матча рядом с тобой
          </div>
          <div className="text-[12px]" style={{ color: "#6b7280" }}>
            Готов выйти на газон сегодня?
          </div>
        </div>
      </div>

      {/* Match card — real photo cover */}
      <div
        className="overflow-hidden rounded-[20px] bg-white"
        style={{
          boxShadow: "0 10px 28px rgba(14,92,47,0.13), 0 2px 6px rgba(0,0,0,0.05)",
        }}
      >
        <div
          className="relative h-28 w-full"
          style={{ background: "linear-gradient(135deg,#176b38,#0e5c2f)" }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={PHOTO}
            alt=""
            className="h-full w-full object-cover"
          />
          <div
            className="absolute inset-0"
            style={{
              background:
                "linear-gradient(180deg, rgba(0,0,0,0) 40%, rgba(0,0,0,0.45))",
            }}
          />
          <span
            className="absolute right-3 top-3 rounded-full px-3 py-1 text-[11px] font-bold"
            style={{
              background: "linear-gradient(135deg,#c5e63c,#a8c82e)",
              color: "#2d3a00",
              boxShadow: "0 4px 12px rgba(197,230,60,0.5)",
            }}
          >
            Almost full
          </span>
          <div className="absolute bottom-2 left-3 text-[15px] font-bold text-white drop-shadow">
            {MATCH.venue}
          </div>
        </div>

        <div className="space-y-3 p-4">
          <div className="flex items-center gap-1.5 text-[12px]" style={{ color: "#6b7280" }}>
            <S name="map-point-wave-bold-duotone" size={16} style={{ color: "#0e5c2f" }} />
            {MATCH.address}
          </div>

          <div className="flex items-center gap-4 text-[13px]" style={{ color: "#1a1a1a" }}>
            <span className="flex items-center gap-1.5 font-semibold">
              <S name="calendar-bold-duotone" size={18} style={{ color: "#0e5c2f" }} />
              {MATCH.date}
            </span>
            <span className="flex items-center gap-1.5 font-semibold">
              <S name="clock-circle-bold-duotone" size={18} style={{ color: "#0e5c2f" }} />
              {MATCH.time}
            </span>
          </div>

          <div className="flex flex-wrap gap-1.5 text-[12px]">
            {["Grass", "Studs OK", "Field booked"].map((t) => (
              <span
                key={t}
                className="rounded-full px-2.5 py-1 font-medium"
                style={{ background: "rgba(14,92,47,0.07)", color: "#176b38" }}
              >
                {t}
              </span>
            ))}
          </div>

          <div
            className="flex items-center justify-between border-t pt-3 text-[13px]"
            style={{ borderColor: "#eee7db" }}
          >
            <span className="flex items-center gap-1.5" style={{ color: "#1a1a1a" }}>
              <S name="users-group-rounded-bold-duotone" size={18} style={{ color: "#d97706" }} />
              <span className="font-bold">
                {MATCH.filled}/{MATCH.capacity}
              </span>
              <span style={{ color: "#6b7280" }}>· {MATCH.free} места</span>
            </span>
            <span className="flex items-center gap-1 font-bold" style={{ color: "#0e5c2f" }}>
              <S name="tag-price-bold-duotone" size={18} style={{ color: "#0e5c2f" }} />
              {MATCH.price}
            </span>
          </div>
        </div>
      </div>

      {/* CTAs */}
      <div className="space-y-2.5">
        <button
          className="flex h-12 w-full items-center justify-center gap-2 rounded-[14px] text-[15px] font-bold"
          style={{
            background: "linear-gradient(135deg,#c5e63c,#a8c82e)",
            color: "#2d3a00",
            boxShadow: "0 6px 18px rgba(197,230,60,0.5)",
          }}
        >
          Join match
          <S name="arrow-right-bold-duotone" size={20} style={{ color: "#2d3a00" }} />
        </button>
        <button
          className="flex h-12 w-full items-center justify-center gap-2 rounded-[14px] text-[15px] font-bold text-white"
          style={{
            background: "linear-gradient(135deg,#176b38,#0e5c2f)",
            boxShadow: "0 6px 18px rgba(14,92,47,0.32)",
          }}
        >
          Create a match
        </button>
      </div>

      <NavBarA />
    </section>
  );
}

function NavBarA() {
  const tabs = [
    { icon: "calendar-bold-duotone", label: "Matches", active: false },
    { icon: "compass-bold-duotone", label: "Games", active: true },
    { icon: "map-point-wave-bold-duotone", label: "Map", active: false },
    { icon: "chat-round-dots-bold-duotone", label: "Chats", active: false },
    { icon: "user-circle-bold-duotone", label: "Me", active: false },
  ];
  return (
    <div
      className="flex items-stretch rounded-[20px] bg-white/90 p-1.5 backdrop-blur"
      style={{ boxShadow: "0 8px 24px rgba(14,92,47,0.12)" }}
    >
      {tabs.map((t) => (
        <div
          key={t.label}
          className="flex flex-1 flex-col items-center gap-0.5 py-1"
        >
          <span
            className="flex h-8 w-12 items-center justify-center rounded-full"
            style={
              t.active
                ? {
                    background: "linear-gradient(135deg,#c5e63c,#a8c82e)",
                    boxShadow: "0 4px 12px rgba(197,230,60,0.45)",
                  }
                : undefined
            }
          >
            <S
              name={t.icon}
              size={22}
              style={{ color: t.active ? "#2d3a00" : "#9ca3af" }}
            />
          </span>
          <span
            className="text-[10px] font-semibold"
            style={{ color: t.active ? "#0e5c2f" : "#9ca3af" }}
          >
            {t.label}
          </span>
        </div>
      ))}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════
//  B. GLASS & GLOW
// ══════════════════════════════════════════════════════════════════════
function DirectionB() {
  return (
    <section
      className="space-y-5 px-4 py-6"
      style={{ background: "linear-gradient(165deg,#0b3322,#061c12)" }}
    >
      <Header
        tag="B"
        title="Glass & glow"
        subtitle="Тёмно-зелёное стекло, неон-лайм, glow-тени. Премиум-вайб."
        tagBg="rgba(197,230,60,0.15)"
        tagColor="#c5e63c"
        dark
      />

      {/* Hero with glowing icon */}
      <div
        className="flex items-center gap-4 rounded-3xl p-5"
        style={{
          background: "rgba(255,255,255,0.06)",
          border: "1px solid rgba(255,255,255,0.12)",
          backdropFilter: "blur(12px)",
        }}
      >
        <div
          className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl"
          style={{
            background: "rgba(197,230,60,0.12)",
            border: "1px solid rgba(197,230,60,0.3)",
          }}
        >
          <S
            name="fire-bold-duotone"
            size={30}
            style={{ color: "#c5e63c", filter: "drop-shadow(0 0 8px rgba(197,230,60,0.7))" }}
          />
        </div>
        <div>
          <div className="text-[15px] font-bold text-white">3 матча рядом</div>
          <div className="text-[12px]" style={{ color: "rgba(255,255,255,0.55)" }}>
            Горят прямо сейчас
          </div>
        </div>
      </div>

      {/* Glass match card */}
      <div
        className="overflow-hidden rounded-3xl"
        style={{
          background: "rgba(255,255,255,0.07)",
          border: "1px solid rgba(255,255,255,0.12)",
          backdropFilter: "blur(12px)",
          boxShadow: "0 12px 40px rgba(0,0,0,0.35)",
        }}
      >
        <div className="relative h-28 w-full">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={PHOTO} alt="" className="h-full w-full object-cover" />
          <div
            className="absolute inset-0"
            style={{
              background:
                "linear-gradient(180deg, rgba(6,28,18,0.1) 30%, rgba(6,28,18,0.9))",
            }}
          />
          <span
            className="absolute right-3 top-3 rounded-full px-3 py-1 text-[11px] font-bold"
            style={{
              background: "rgba(197,230,60,0.15)",
              border: "1px solid rgba(197,230,60,0.4)",
              color: "#c5e63c",
              boxShadow: "0 0 16px rgba(197,230,60,0.35)",
            }}
          >
            Almost full
          </span>
          <div className="absolute bottom-2 left-3 text-[15px] font-bold text-white">
            {MATCH.venue}
          </div>
        </div>

        <div className="space-y-3 p-4">
          <div
            className="flex items-center gap-1.5 text-[12px]"
            style={{ color: "rgba(255,255,255,0.55)" }}
          >
            <S name="map-point-wave-bold-duotone" size={16} style={{ color: "#c5e63c" }} />
            {MATCH.address}
          </div>

          <div className="flex items-center gap-4 text-[13px] text-white">
            <span className="flex items-center gap-1.5 font-semibold">
              <S name="calendar-bold-duotone" size={18} style={{ color: "#c5e63c" }} />
              {MATCH.date}
            </span>
            <span className="flex items-center gap-1.5 font-semibold">
              <S name="clock-circle-bold-duotone" size={18} style={{ color: "#c5e63c" }} />
              {MATCH.time}
            </span>
          </div>

          <div className="flex flex-wrap gap-1.5 text-[12px]">
            {["Grass", "Studs OK", "Field booked"].map((t) => (
              <span
                key={t}
                className="rounded-full px-2.5 py-1 font-medium"
                style={{
                  background: "rgba(255,255,255,0.08)",
                  border: "1px solid rgba(255,255,255,0.12)",
                  color: "rgba(255,255,255,0.8)",
                }}
              >
                {t}
              </span>
            ))}
          </div>

          <div
            className="flex items-center justify-between border-t pt-3 text-[13px]"
            style={{ borderColor: "rgba(255,255,255,0.1)" }}
          >
            <span className="flex items-center gap-1.5 text-white">
              <S name="users-group-rounded-bold-duotone" size={18} style={{ color: "#fbbf24" }} />
              <span className="font-bold">
                {MATCH.filled}/{MATCH.capacity}
              </span>
              <span style={{ color: "rgba(255,255,255,0.5)" }}>· {MATCH.free} места</span>
            </span>
            <span className="flex items-center gap-1 font-bold" style={{ color: "#c5e63c" }}>
              <S name="tag-price-bold-duotone" size={18} style={{ color: "#c5e63c" }} />
              {MATCH.price}
            </span>
          </div>
        </div>
      </div>

      <div className="space-y-2.5">
        <button
          className="flex h-12 w-full items-center justify-center gap-2 rounded-2xl text-[15px] font-bold"
          style={{
            background: "#c5e63c",
            color: "#0b3322",
            boxShadow: "0 0 24px rgba(197,230,60,0.5)",
          }}
        >
          Join match
          <S name="arrow-right-bold-duotone" size={20} style={{ color: "#0b3322" }} />
        </button>
        <button
          className="flex h-12 w-full items-center justify-center gap-2 rounded-2xl text-[15px] font-bold text-white"
          style={{
            background: "rgba(255,255,255,0.08)",
            border: "1px solid rgba(255,255,255,0.18)",
          }}
        >
          Create a match
        </button>
      </div>

      <NavBarB />
    </section>
  );
}

function NavBarB() {
  const tabs = [
    { icon: "calendar-bold-duotone", label: "Matches", active: false },
    { icon: "compass-bold-duotone", label: "Games", active: true },
    { icon: "map-point-wave-bold-duotone", label: "Map", active: false },
    { icon: "chat-round-dots-bold-duotone", label: "Chats", active: false },
    { icon: "user-circle-bold-duotone", label: "Me", active: false },
  ];
  return (
    <div
      className="flex items-stretch rounded-3xl p-1.5"
      style={{
        background: "rgba(255,255,255,0.06)",
        border: "1px solid rgba(255,255,255,0.12)",
        backdropFilter: "blur(12px)",
      }}
    >
      {tabs.map((t) => (
        <div key={t.label} className="flex flex-1 flex-col items-center gap-0.5 py-1">
          <span
            className="flex h-8 w-12 items-center justify-center rounded-full"
            style={
              t.active
                ? {
                    background: "rgba(197,230,60,0.16)",
                    boxShadow: "0 0 16px rgba(197,230,60,0.4)",
                  }
                : undefined
            }
          >
            <S
              name={t.icon}
              size={22}
              style={{
                color: t.active ? "#c5e63c" : "rgba(255,255,255,0.4)",
                filter: t.active ? "drop-shadow(0 0 6px rgba(197,230,60,0.7))" : undefined,
              }}
            />
          </span>
          <span
            className="text-[10px] font-semibold"
            style={{ color: t.active ? "#c5e63c" : "rgba(255,255,255,0.4)" }}
          >
            {t.label}
          </span>
        </div>
      ))}
    </div>
  );
}

// ── Shared section header ─────────────────────────────────────────────
function Header({
  tag,
  title,
  subtitle,
  tagBg,
  tagColor,
  dark,
}: {
  tag: string;
  title: string;
  subtitle: string;
  tagBg: string;
  tagColor: string;
  dark?: boolean;
}) {
  return (
    <div className="flex items-start gap-3">
      <span
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-[16px] font-extrabold"
        style={{ background: tagBg, color: tagColor }}
      >
        {tag}
      </span>
      <div>
        <h2
          className="text-[18px] font-extrabold leading-tight"
          style={{ color: dark ? "#ffffff" : "#0e5c2f" }}
        >
          {title}
        </h2>
        <p
          className="text-[12px]"
          style={{ color: dark ? "rgba(255,255,255,0.55)" : "#6b7280" }}
        >
          {subtitle}
        </p>
      </div>
    </div>
  );
}

export default function StyleLabPage() {
  return (
    <main className="pb-10">
      <div className="px-4 pb-2 pt-6">
        <h1 className="text-[22px] font-extrabold" style={{ color: "#0e5c2f" }}>
          Style Lab
        </h1>
        <p className="text-[13px]" style={{ color: "#6b7280" }}>
          Один и тот же экран в двух направлениях. Скролль и сравнивай.
        </p>
      </div>
      <DirectionA />
      <DirectionB />
    </main>
  );
}
