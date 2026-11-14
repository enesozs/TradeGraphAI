import * as Plot from "@observablehq/plot";
import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { Page, Swatch } from "@/components/page";
import { PlotFigure, TIP } from "@/components/plot-figure";
import { Badge } from "@/components/ui/badge";
import { Collapsible, CollapsiblePanel, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useCountryColors } from "@/lib/country-colors";
import { useJson, useQuery } from "@/lib/db";
import { countryName, pct } from "@/lib/format";
import { useGeo } from "@/lib/geo";
import { useBuildInfo } from "@/lib/meta";

type Mover = { importer_iso3: string; supplier_iso3: string; start_share: number; end_share: number; delta_share: number };
type Metric = { mae_log: number; wape_usd: number; skill_vs_persistence?: number };
type ForecastMetrics = {
  caveat: string;
  post_hoc_models: string[];
  post_hoc_note: string;
  folds: { target_year: number; role: string; models: Record<string, Metric> }[];
  breakdown: { validation: { pooled: Record<string, Metric> }; holdout: { pooled: Record<string, Metric> } };
};
type EuRow = { month: string; top1_iso3_12m: string; top1_share_12m: number; hhi_12m: number };

const pp = (x: number) => `${x >= 0 ? "+" : ""}${(100 * x).toFixed(1)} pp`;
const monthShort = (iso?: string) => (iso ? new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-GB", { month: "short", year: "numeric", timeZone: "UTC" }) : "–");
const linkCls = "text-foreground underline decoration-border underline-offset-4 hover:decoration-foreground";

function useColor() {
  const colors = useCountryColors();
  return (iso3: string | null | undefined) => {
    const c = iso3 ? colors?.get(iso3) : undefined;
    return c ? `rgb(${c[0]}, ${c[1]}, ${c[2]})` : "#93a8ba";
  };
}

function Finding({ n, title, tags, children }: { n: number; title: string; tags: ReactNode; children: ReactNode }) {
  return (
    <article className="space-y-6 border-t pt-10">
      <div className="max-w-3xl space-y-3">
        <p className="text-sm text-muted-foreground">Finding {n}</p>
        <h2 className="text-2xl font-semibold text-foreground">{title}</h2>
        <div className="flex flex-wrap gap-1.5">{tags}</div>
      </div>
      {children}
    </article>
  );
}

function Points({ children }: { children: ReactNode }) {
  return <ul className="max-w-3xl list-disc space-y-2.5 pl-5 text-sm text-muted-foreground marker:text-border [&_strong]:text-foreground">{children}</ul>;
}

function TableToggle({ label, children }: { label: string; children: ReactNode }) {
  return (
    <Collapsible>
      <CollapsibleTrigger className="text-sm text-muted-foreground underline decoration-border underline-offset-4 hover:text-foreground">{label}</CollapsibleTrigger>
      <CollapsiblePanel><div className="pt-3">{children}</div></CollapsiblePanel>
    </Collapsible>
  );
}

const MODEL_LABEL: Record<string, string> = {
  persistence: "Same as last year (persistence)",
  gbm_graph: "Gradient boosting with network features",
  gbm_delta: "Gradient boosting on the change from last year",
};

export function FindingsPage() {
  const info = useBuildInfo();
  const fm = useJson<ForecastMetrics>("forecast_metrics.json");
  const geo = useGeo();
  const color = useColor();
  const name = (iso3: string) => countryName(iso3, geo?.names.get(iso3));

  // Same query as the legacy page: four largest share changes per importer.
  const ree = useQuery<Mover>(
    `SELECT importer_iso3, supplier_iso3, start_share, end_share, delta_share FROM movers_supplier
     WHERE basket_id = 'rare_earths_and_magnets' AND importer_iso3 IN ('DEU', 'USA')
     QUALIFY row_number() OVER (PARTITION BY importer_iso3 ORDER BY abs(delta_share) DESC) <= 4
     ORDER BY importer_iso3, abs(delta_share) DESC`,
  ).data ?? [];
  const eu = useQuery<EuRow>(
    `SELECT strftime(month, '%Y-%m-%d') AS month, top1_iso3_12m, top1_share_12m, hhi_12m FROM comext_importer
     WHERE reporter = 'EU27_2020_EXTRA' AND basket_id = 'li_ion_batteries' AND top1_share_12m IS NOT NULL ORDER BY month`,
  ).data ?? [];

  const val = fm?.breakdown.validation.pooled;
  const hold = fm?.breakdown.holdout.pooled;
  const folds = fm?.folds ?? [];
  const holdYear = folds.find((f) => f.role === "holdout")?.target_year;
  const valYears = folds.filter((f) => f.role === "validation").map((f) => f.target_year);
  const skills = folds.map((f) => f.models.gbm_graph?.skill_vs_persistence).filter((x): x is number => x != null);

  const euFirst = eu[0], euLast = eu.at(-1);
  const euLow = eu.reduce<EuRow | undefined>((a, b) => (!a || b.top1_share_12m < a.top1_share_12m ? b : a), undefined);
  const euChn = eu.every((d) => d.top1_iso3_12m === "CHN");

  const importers = [...new Set(ree.map((d) => d.importer_iso3))];
  const shareMax = Math.max(0.8, ...ree.map((d) => Math.max(d.start_share, d.end_share)));

  return (
    <Page
      title="Findings"
      lead="Three results from the pipeline, each reproducible from the published data. The full write-ups, with every number and its caveats, are in the project repository under reports/."
    >
      <Finding
        n={1}
        title="Germany and the US now buy about three-quarters of their rare-earth-and-magnet imports from China"
        tags={<>
          <Badge variant="outline">Observed</Badge>
          <Badge variant="outline">CEPII BACI {info?.source.hs_revision} V{info?.source.release}</Badge>
          <Badge variant="outline">Share of import value, 2012–14 average against 2021–23 average</Badge>
        </>}
      >
        <div className="grid gap-8 md:grid-cols-2">
          {importers.map((imp) => {
            const rows = ree.filter((d) => d.importer_iso3 === imp);
            return (
              <figure key={imp} className="space-y-2">
                <figcaption className="flex items-center gap-2 text-sm font-medium text-foreground"><Swatch color={color(imp)} />{name(imp)}: largest changes in supplier share</figcaption>
                <PlotFigure
                  label={`${name(imp)}: the four suppliers whose share of rare-earth and magnet imports changed most between 2012–14 and 2021–23.`}
                  deps={[rows, color, geo]}
                  make={(width) => ({
                    width, height: 72 + rows.length * 44, marginLeft: 96, marginRight: 56, marginBottom: 44,
                    x: { domain: [0, 100 * shareMax], percent: true, label: "Share of import value (%)", grid: true },
                    y: { domain: rows.map((d) => d.supplier_iso3), label: null, tickFormat: (s: string) => (s === "S19" ? "Taiwan" : name(s)) },
                    marks: [
                      Plot.link(rows, { x1: "start_share", x2: "end_share", y: "supplier_iso3", stroke: (d: Mover) => color(d.supplier_iso3), strokeWidth: 2, strokeOpacity: 0.6, markerEnd: "arrow" }),
                      Plot.dot(rows, { x: "start_share", y: "supplier_iso3", r: 4, stroke: (d: Mover) => color(d.supplier_iso3), fill: "var(--tg-ink)" }),
                      Plot.dot(rows, { x: "end_share", y: "supplier_iso3", r: 5, fill: (d: Mover) => color(d.supplier_iso3) }),
                      Plot.text(rows, { x: (d: Mover) => Math.max(d.start_share, d.end_share), y: "supplier_iso3", text: (d: Mover) => pp(d.delta_share), dx: 12, textAnchor: "start", fill: "var(--tg-paper)" }),
                      Plot.tip(rows, Plot.pointerY({ x: "end_share", y: "supplier_iso3", ...TIP, title: (d: Mover) => `${name(d.supplier_iso3)}\n2012–14: ${pct(d.start_share)}\n2021–23: ${pct(d.end_share)}\nChange: ${pp(d.delta_share)}` })),
                    ],
                  })}
                />
              </figure>
            );
          })}
        </div>
        <p className="text-xs text-muted-foreground">Hollow dot: 2012–14 average share. Filled dot: 2021–23 average share. Denominator: imports from all partners, by value (thousands of current USD).</p>

        <Table>
          <TableHeader>
            <TableRow><TableHead>Importer</TableHead><TableHead>Supplier</TableHead><TableHead className="text-right">Share 2012–14</TableHead><TableHead className="text-right">Share 2021–23</TableHead><TableHead className="text-right">Change</TableHead></TableRow>
          </TableHeader>
          <TableBody>
            {ree.map((d) => (
              <TableRow key={`${d.importer_iso3}-${d.supplier_iso3}`}>
                <TableCell><span className="inline-flex items-center gap-2"><Swatch color={color(d.importer_iso3)} />{name(d.importer_iso3)}</span></TableCell>
                <TableCell><span className="inline-flex items-center gap-2"><Swatch color={color(d.supplier_iso3)} />{name(d.supplier_iso3)}</span></TableCell>
                <TableCell className="text-right tabular-nums">{pct(d.start_share)}</TableCell>
                <TableCell className="text-right tabular-nums">{pct(d.end_share)}</TableCell>
                <TableCell className="text-right tabular-nums">{pp(d.delta_share)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>

        <Points>
          <li><strong>The shift is driven by permanent magnets</strong>, which carry most of the basket's value. China's share of German magnet imports rose from 61% to 80% by value, and from 57% to 76% for the US.</li>
          <li><strong>Value and tonnes disagree for the US.</strong> China's tonnage share of US magnet imports fell (88% to 74%) while its value share rose. That points to a product-mix or price change, consistent with more rare-earth (NdFeB) magnets, but the trade code can't confirm it.</li>
          <li><strong>Rare-earth materials move differently.</strong> For Germany, China's share fell by value but rose by tonnes. With prices this volatile, value shares shouldn't be read alone.</li>
          <li><strong>Caveat:</strong> code 850511 covers all metal magnets, not only rare-earth ones.</li>
        </Points>
        <p className="max-w-3xl text-xs text-muted-foreground">The magnet-level and tonnage figures in these points come from the code-level write-up in reports/, not from the basket table above. <Link to="/movers" className={linkCls}>See every mover in Biggest movers</Link>.</p>
      </Finding>

      <Finding
        n={2}
        title={`Forecasting: "same as last year" is hard to beat where the money is`}
        tags={<>
          <Badge variant="outline">Forecast benchmark</Badge>
          <Badge variant="outline">Retrospective, chronological folds {valYears[0] ?? "–"}–{valYears.at(-1) ?? "–"}, holdout {holdYear ?? "–"}</Badge>
        </>}
      >
        <Points>
          <li><strong>Log error:</strong> gradient boosting with network features beats persistence by {skills.length ? `${pct(Math.min(...skills))} to ${pct(Math.max(...skills))}` : "–"} in every fold (holdout MAE {hold?.gbm_graph?.mae_log.toFixed(3) ?? "–"} against {hold?.persistence?.mae_log.toFixed(3) ?? "–"}).</li>
          <li><strong>Value-weighted error:</strong> persistence wins (holdout WAPE {pct(hold?.persistence?.wape_usd)} against {pct(hold?.gbm_graph?.wape_usd)}). The models gain on many small links and lose on the few large ones.</li>
          <li><strong>Predicting the change from last year</strong> (added after the holdout, so validation only) comes closest. Its validation WAPE is {pct(val?.gbm_delta?.wape_usd)} against {pct(val?.persistence?.wape_usd)} for persistence, with the best log error (+{val ? pct(1 - val.gbm_delta.mae_log / val.persistence.mae_log) : "–"} skill). A clean test needs 2024 data once a later BACI release finalises it.</li>
          <li><strong>Network features add almost nothing</strong>, and a gravity model is no one-year forecaster.</li>
        </Points>
        <div className="max-w-4xl">
          <Table>
            <TableHeader>
              <TableRow><TableHead>Model</TableHead><TableHead className="text-right">Validation WAPE</TableHead><TableHead className="text-right">Holdout WAPE</TableHead><TableHead className="text-right">Validation MAE (log)</TableHead><TableHead className="text-right">Holdout MAE (log)</TableHead></TableRow>
            </TableHeader>
            <TableBody>
              {Object.keys(MODEL_LABEL).map((m) => {
                const postHoc = fm?.post_hoc_models.includes(m);
                return (
                  <TableRow key={m}>
                    <TableCell>{MODEL_LABEL[m]}{postHoc && <span className="text-muted-foreground"> (post hoc)</span>}</TableCell>
                    <TableCell className="text-right tabular-nums">{pct(val?.[m]?.wape_usd)}</TableCell>
                    <TableCell className="text-right tabular-nums">{postHoc ? "not a clean test" : pct(hold?.[m]?.wape_usd)}</TableCell>
                    <TableCell className="text-right tabular-nums">{val?.[m]?.mae_log.toFixed(3) ?? "–"}</TableCell>
                    <TableCell className="text-right tabular-nums">{postHoc ? "not a clean test" : hold?.[m]?.mae_log.toFixed(3) ?? "–"}</TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
          <p className="mt-3 text-xs text-muted-foreground">
            Pooled over all trade links in each set; lower is better. WAPE weights errors by trade value in USD. {fm?.caveat} {fm?.post_hoc_note}{" "}
            <Link to="/forecast" className={linkCls}>Open the Forecast lab</Link>.
          </p>
        </div>
      </Finding>

      <Finding
        n={3}
        title="The EU's lithium-ion battery imports from outside the EU are about 90% Chinese, and rising"
        tags={<>
          <Badge variant="outline">Observed</Badge>
          <Badge variant="outline">Eurostat Comext DS-045409, monthly, EUR</Badge>
          <Badge variant="outline">Trailing 12 months, all extra-EU partners</Badge>
        </>}
      >
        <p className="max-w-3xl text-sm text-muted-foreground">
          The trailing-12-month share of the top supplier{euChn ? ", China in every month shown," : ""} fell to a low of {pct(euLow?.top1_share_12m)} in the 12 months to {monthShort(euLow?.month)}, then rose to {pct(euLast?.top1_share_12m)} by {monthShort(euLast?.month)}, as the supplier HHI climbed from {euLow?.hhi_12m.toFixed(2) ?? "–"} to {euLast?.hhi_12m.toFixed(2) ?? "–"}. These are importer-declared EU statistics, not reconciled like BACI.
        </p>
        <figure className="space-y-2">
          <figcaption className="flex items-center gap-2 text-sm font-medium text-foreground"><Swatch color={color("CHN")} />Top supplier's share of extra-EU lithium-ion battery imports, trailing 12 months</figcaption>
          <PlotFigure
            label={`Line chart: the top supplier's trailing-12-month share of EU lithium-ion battery imports from outside the EU, ${monthShort(euFirst?.month)} to ${monthShort(euLast?.month)}.`}
            deps={[eu, color]}
            make={(width) => {
              const rows = eu.map((d) => ({ ...d, date: new Date(`${d.month}T00:00:00Z`) }));
              return {
                width, height: 260, marginLeft: 48,
                x: { type: "utc", label: null },
                y: { domain: [80, 95], percent: true, label: "Share of import value (%)", grid: true },
                marks: [
                  Plot.lineY(rows, { x: "date", y: "top1_share_12m", stroke: color("CHN"), strokeWidth: 2 }),
                  Plot.dot(rows.slice(-1), { x: "date", y: "top1_share_12m", fill: color("CHN"), r: 4 }),
                  Plot.tip(rows, Plot.pointerX({ x: "date", y: "top1_share_12m", ...TIP, title: (d: EuRow) => `12 months to ${monthShort(d.month)}\n${name(d.top1_iso3_12m)}: ${pct(d.top1_share_12m)}\nHHI ${d.hhi_12m.toFixed(3)}` })),
                ],
              };
            }}
          />
        </figure>
        <TableToggle label="Show the monthly table">
          <div className="max-h-80 max-w-xl overflow-y-auto">
            <Table>
              <TableHeader><TableRow><TableHead>12 months to</TableHead><TableHead>Top supplier</TableHead><TableHead className="text-right">Share</TableHead><TableHead className="text-right">HHI</TableHead></TableRow></TableHeader>
              <TableBody>
                {[...eu].reverse().map((d) => (
                  <TableRow key={d.month}>
                    <TableCell>{monthShort(d.month)}</TableCell>
                    <TableCell>{name(d.top1_iso3_12m)}</TableCell>
                    <TableCell className="text-right tabular-nums">{pct(d.top1_share_12m)}</TableCell>
                    <TableCell className="text-right tabular-nums">{d.hhi_12m.toFixed(3)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </TableToggle>
        <p className="text-sm"><Link to="/eu-monthly" className={linkCls}>See the latest month in the EU monthly monitor</Link></p>
      </Finding>
    </Page>
  );
}
