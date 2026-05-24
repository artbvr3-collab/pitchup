/**
 * MODULE: tailwind.config
 * PURPOSE: Bind Tailwind utility classes to the canonical PITCHUP design tokens
 *          declared in app/globals.css (`:root { --… }`). Every color, radius,
 *          and shadow listed here must point to a CSS variable — no raw hex.
 * LAYER: build config
 * RELATED DOCS: docs/ARCHITECTURE.md §11, mockups/match.html (token header).
 */
import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        bg: {
          base: "var(--bg-base)",
          surface: "var(--bg-surface)",
          card: "var(--bg-card)",
          "card-dim": "var(--bg-card-dim)",
        },
        green: {
          dark: "var(--green-dark)",
          mid: "var(--green-mid)",
        },
        lime: {
          DEFAULT: "var(--lime)",
          dark: "var(--lime-dark)",
          text: "var(--lime-text)",
        },
        text: {
          primary: "var(--text-primary)",
          secondary: "var(--text-secondary)",
          muted: "var(--text-muted)",
          inverted: "var(--text-inverted)",
        },
        status: {
          open: "var(--status-open)",
          almost: "var(--status-almost)",
          full: "var(--status-full)",
          "in-progress": "var(--status-in-progress)",
        },
        border: {
          DEFAULT: "var(--border)",
          strong: "var(--border-strong)",
          focus: "var(--border-focus)",
        },
        destructive: {
          DEFAULT: "var(--destructive)",
          bg: "var(--destructive-bg)",
        },
      },
      borderColor: {
        DEFAULT: "var(--border)",
      },
      borderRadius: {
        card: "var(--radius-card)",
        btn: "var(--radius-btn)",
        chip: "var(--radius-chip)",
        badge: "var(--radius-badge)",
      },
      boxShadow: {
        card: "var(--shadow-card)",
        btn: "var(--shadow-btn)",
        "btn-lime": "var(--shadow-btn-lime)",
      },
      fontFamily: {
        sans: ['"Inter"', "system-ui", "-apple-system", "sans-serif"],
      },
      maxWidth: {
        screen: "375px",
      },
    },
  },
  plugins: [],
};

export default config;
