/**
 * MODULE: app.design.interactive-demos
 * PURPOSE: Client island for the /design catalog. Wraps the three stateful
 *          primitives (Stepper, Switch, Checkbox) so the parent page can stay
 *          a Server Component.
 * LAYER: interfaces (design catalog only)
 */
"use client";

import * as React from "react";
import { Checkbox } from "@/src/ui/components/checkbox";
import { Stepper } from "@/src/ui/components/stepper";
import { Switch } from "@/src/ui/components/switch";

export function StepperDemo() {
  const [value, setValue] = React.useState(14);
  return <Stepper value={value} onChange={setValue} min={2} max={22} ariaLabel="Total spots" />;
}

export function SwitchDemo() {
  const [on, setOn] = React.useState(true);
  return (
    <div className="flex items-center gap-3">
      <Switch checked={on} onCheckedChange={setOn} aria-label="Field booked" />
      <span className="text-[13px] text-text-secondary">{on ? "On" : "Off"}</span>
    </div>
  );
}

export function CheckboxDemo() {
  const [checked, setChecked] = React.useState(true);
  return (
    <div className="flex items-center gap-3">
      <Checkbox checked={checked} onCheckedChange={(c) => setChecked(c === true)} id="cb-demo" />
      <label htmlFor="cb-demo" className="cursor-pointer text-[14px] text-text-primary">
        Studs allowed
      </label>
    </div>
  );
}
