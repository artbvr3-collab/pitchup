/**
 * MODULE: app.design.page
 * PURPOSE: Live component catalog for the PITCHUP UI kit. Every primitive in
 *          `src/ui/components/` is rendered here with all variants/states on
 *          the canonical cream background. A new component must appear here
 *          before being consumed by a feature screen (CODING_STANDARDS §1).
 * LAYER: interfaces (dev-only, excluded from production sitemap via robots meta)
 * RELATED DOCS: docs/ARCHITECTURE.md §11 — note: spec calls this "/_design"
 *          but Next.js App Router treats `_`-prefixed folders as private and
 *          excludes them from routing, so the live URL is "/design" instead.
 *          Pending an ARCHITECTURE doc fix.
 */
import { Button } from "@/src/ui/components/button";
import { Card } from "@/src/ui/components/card";
import { Chip } from "@/src/ui/components/chip";
import { Input } from "@/src/ui/components/input";
import {
  CheckboxDemo,
  StepperDemo,
  SwitchDemo,
} from "@/app/design/interactive-demos";

export const metadata = {
  title: "/design — PITCHUP UI kit",
  robots: { index: false, follow: false },
};

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-3 px-4">
      <h2 className="text-[13px] font-semibold uppercase tracking-[0.06em] text-text-secondary">
        {title}
      </h2>
      <Card className="flex flex-col gap-3">{children}</Card>
    </section>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-[11px] uppercase tracking-wider text-text-muted">{label}</span>
      <div className="flex flex-wrap items-center gap-2">{children}</div>
    </div>
  );
}

export default function DesignCatalogPage() {
  return (
    <main className="flex min-h-dvh flex-col gap-5 py-6">
      <header className="px-4">
        <h1 className="text-[22px] font-bold text-text-primary">PITCHUP UI Kit</h1>
        <p className="text-[13px] text-text-secondary">
          Layer 0 — bare scaffold. All primitives use canonical tokens from{" "}
          <code>mockups/match.html</code>.
        </p>
      </header>

      <Section title="Button">
        <Row label="primary">
          <Button variant="primary">Join match</Button>
        </Row>
        <Row label="lime CTA">
          <Button variant="lime">Confirm join</Button>
        </Row>
        <Row label="ghost">
          <Button variant="ghost">Cancel</Button>
        </Row>
        <Row label="destructive-ghost">
          <Button variant="destructive-ghost">Leave match</Button>
        </Row>
        <Row label="disabled">
          <Button variant="disabled" disabled>
            Match full
          </Button>
        </Row>
        <Row label="size=lg (publish)">
          <Button variant="primary" size="lg">
            Publish match
          </Button>
        </Row>
      </Section>

      <Section title="Card">
        <Row label="default (16px padding)">
          <Card className="w-full">
            <p className="text-[15px] font-semibold text-text-primary">FC Pickup · Sat 7pm</p>
            <p className="text-[13px] text-text-secondary">Astroturf · 14/20 spots</p>
          </Card>
        </Row>
        <Row label="compact (player-chip)">
          <Card variant="compact" className="inline-flex items-center gap-2.5">
            <span className="flex h-8 w-8 items-center justify-center rounded-full bg-green-dark text-[12px] font-semibold text-text-inverted">
              IV
            </span>
            <span className="text-[14px] font-medium text-text-primary">Ivan N.</span>
          </Card>
        </Row>
      </Section>

      <Section title="Chip">
        <Row label="inactive / active / custom">
          <Chip>60 min</Chip>
          <Chip active>90 min</Chip>
          <Chip>120 min</Chip>
          <Chip custom>Custom</Chip>
        </Row>
      </Section>

      <Section title="Input">
        <Row label="text">
          <Input placeholder="Search venue…" />
        </Row>
        <Row label="filled">
          <Input defaultValue="Maracana Sports Centre" />
        </Row>
        <Row label="disabled">
          <Input placeholder="Locked field" disabled />
        </Row>
      </Section>

      <Section title="Stepper">
        <Row label="2 ≤ value ≤ 22">
          <StepperDemo />
        </Row>
      </Section>

      <Section title="Switch">
        <Row label="Radix-backed">
          <SwitchDemo />
        </Row>
      </Section>

      <Section title="Checkbox">
        <Row label="Radix-backed">
          <CheckboxDemo />
        </Row>
      </Section>
    </main>
  );
}
