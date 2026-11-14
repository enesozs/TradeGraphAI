import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

// Shared page frame for every non-map view: one column, generous measure, title + lead + provenance.
export function Page({ title, lead, meta, actions, children, wide }: {
  title: string; lead?: ReactNode; meta?: ReactNode; actions?: ReactNode; children: ReactNode; wide?: boolean;
}) {
  return (
    <main className={cn("mx-auto w-full min-w-0 px-4 pb-24 pt-10 sm:px-8 lg:pt-14", wide ? "max-w-7xl" : "max-w-6xl")}>
      <header className="mb-10 flex flex-col gap-6">
        <div className="max-w-3xl space-y-3">
          <h1 className="figure text-3xl text-foreground sm:text-4xl">{title}</h1>
          {lead && <p className="text-base text-muted-foreground sm:text-lg">{lead}</p>}
          {meta && <div className="flex flex-wrap gap-1.5 pt-1">{meta}</div>}
        </div>
        {actions && <div className="flex flex-wrap items-end gap-x-5 gap-y-3 rounded-lg border bg-card/40 p-4">{actions}</div>}
      </header>
      <div className="space-y-14">{children}</div>
    </main>
  );
}

// A titled section. `note` sits under the content (units, denominators, caveats).
export function Section({ title, description, note, children, className }: {
  title: string; description?: ReactNode; note?: ReactNode; children: ReactNode; className?: string;
}) {
  return (
    <section className={cn("space-y-4", className)}>
      <div className="max-w-3xl space-y-1.5">
        <h2 className="text-lg font-semibold text-foreground">{title}</h2>
        {description && <p className="text-sm text-muted-foreground">{description}</p>}
      </div>
      {children}
      {note && <p className="max-w-3xl text-xs text-muted-foreground">{note}</p>}
    </section>
  );
}

// Key figure: big number, small label, optional context line. `tone` marks scenario results (never observed).
export function Stat({ label, value, context, tone = "observed", accent }: {
  label: ReactNode; value: ReactNode; context?: ReactNode; tone?: "observed" | "scenario" | "forecast"; accent?: string;
}) {
  return (
    <div className="relative overflow-hidden rounded-lg border bg-card/60 p-5">
      {accent && <span aria-hidden className="absolute inset-y-0 left-0 w-0.5" style={{ background: accent, boxShadow: `0 0 12px ${accent}` }} />}
      <p className="text-sm text-muted-foreground">{label}</p>
      <p className={cn("figure mt-2 text-2xl sm:text-3xl", tone === "scenario" ? "text-[var(--tg-scenario)]" : "text-foreground")}>{value}</p>
      {context && <p className="mt-2 text-xs text-muted-foreground">{context}</p>}
    </div>
  );
}

// Glowing colour chip for a country (same colour as on the maps).
export function Swatch({ color, className }: { color: string; className?: string }) {
  return <span aria-hidden className={cn("inline-block size-2.5 shrink-0 rounded-full", className)} style={{ background: color, boxShadow: `0 0 8px ${color}` }} />;
}
