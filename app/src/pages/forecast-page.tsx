import * as Plot from "@observablehq/plot";
import * as d3 from "d3";
import { useMemo, useState } from "react";
import { Page, Section, Stat } from "@/components/page";
import { PlotFigure, TIP } from "@/components/plot-figure";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { useJson, useQuery } from "@/lib/db";
import { countryName, pct, usd } from "@/lib/format";
import { useGeo } from "@/lib/geo";
import { useBuildInfo } from "@/lib/meta";
import { DataTable, type Column } from "./network-page-table";

type Metric = { n: number; mae_log: number; rmse_log: number; wape_usd: number; bias_log: number; skill_vs_persistence?: number };
type Fold = { target_year: number; role: "validation" | "holdout"; n_train: number; n_test: number; disappearance_rate: number; models: Record<string, Metric> };
type Metrics = {
  target: string; caveat: string; models: string[]; post_hoc_models: string[]; post_hoc_note: string; folds: Fold[];
  breakdown: Record<"validation" | "holdout", { pooled: Record<string, Metric>; by_size: Record<string, Metric> }>;
};
type Pred = { target_year: number; model: string; actual_kusd: number; pred_kusd: number };
type LinkOpt = { basket_id: string; importer_iso3: string; exporter_iso3: string; mx: number };

const LABEL: Record<string, string> = {
  persistence: "Persistence (last year)", mean3: "3-year mean", gravity: "Gravity (PPML)", ridge: "Ridge regression",
  gbm: "Gradient boosting", gbm_graph: "Gradient boosting + network", gbm_weighted: "Boosting, value-weighted †",
  gbm_delta: "Boosting on change †", gbm_delta_weighted: "Boosting on change, value-weighted †",
};
const COLOR: Record<string, string> = {
  persistence: "#c3ced8", mean3: "#7c8fa1", gravity: "#f2a96b", ridge: "#79d9b0", gbm: "#62c7e6",
  gbm_graph: "#a996f5", gbm_weighted: "#ef8f9a", gbm_delta: "#9fd4c8", gbm_delta_weighted: "#e6cf72",
};
const KEY = ["persistence", "gravity", "gbm"];
const SIZES = ["< $1 m", "$1–10 m", "$10–100 m", "≥ $100 m"];
const BG = "#0e1519";
const signed = (x: number) => `${x >= 0 ? "+" : ""}${(100 * x).toFixed(1)}%`;

export function ForecastPage() {
  const info = useBuildInfo();
  const fm = useJson<Metrics>("forecast_metrics.json");
  const geo = useGeo();
  const [scope, setScope] = useState<"key" | "all">("key");
  const [pick, setPick] = useState<string | null>(null);
  const name = (c: string) => geo?.names.get(c) ?? countryName(c);

  const linksQ = useQuery<LinkOpt>(
    `SELECT basket_id, importer_iso3, exporter_iso3, max(actual_kusd) AS mx FROM forecast_predictions GROUP BY ALL ORDER BY mx DESC LIMIT 400`,
  );
  const links = linksQ.data ?? [];
  const linkKey = (l: LinkOpt) => `${l.basket_id}|${l.exporter_iso3}|${l.importer_iso3}`;
  const current = pick ?? (links[0] ? linkKey(links[0]) : null);
  const [pb, pe, pi] = (current ?? "||").split("|");
  const seriesQ = useQuery<Pred>(
    `SELECT target_year, model, actual_kusd, pred_kusd FROM forecast_predictions WHERE basket_id = ? AND exporter_iso3 = ? AND importer_iso3 = ? ORDER BY target_year`,
    [pb, pe, pi],
  );

  const models = fm?.models ?? [];
  const shown = scope === "key" ? models.filter((m) => KEY.includes(m)) : models;
  const color = { domain: shown.map((m) => LABEL[m]), range: shown.map((m) => COLOR[m]), legend: true };
  const holdout = fm?.folds.find((f) => f.role === "holdout");
  const val = fm?.folds.filter((f) => f.role === "validation") ?? [];

  const perFold = useMemo(
    () => (fm ? fm.folds.flatMap((f) => shown.map((m) => ({ target: f.target_year, m, model: LABEL[m], mae: f.models[m].mae_log, skill: f.models[m].skill_vs_persistence ?? 0, role: f.role }))) : []),
    [fm, shown], // eslint-disable-line react-hooks/exhaustive-deps
  );
  const years = info ? d3.range(info.years[0], info.years.at(-1)! + 1) : [];
  const ribbon = fm
    ? fm.folds.flatMap((f) => years.map((y) => ({
        fold: `Target ${f.target_year}${f.role === "holdout" ? " (holdout)" : ""}`, year: y,
        kind: y <= f.target_year - 2 ? "Training (features + targets)" : y === f.target_year - 1 ? "Features for test" : y === f.target_year ? (f.role === "holdout" ? "Holdout target" : "Validation target") : "Unused",
      })))
    : [];
  type SRow = { m: string; Model: string; mae: number; rmse: number; wape: number; bias: number; skill: number; n: number };
  const summaryRows = (role: "validation" | "holdout"): SRow[] =>
    fm ? models.map((m) => {
      const v = fm.breakdown[role].pooled[m], p = fm.breakdown[role].pooled.persistence;
      return { m, Model: LABEL[m], mae: v.mae_log, rmse: v.rmse_log, wape: v.wape_usd, bias: v.bias_log, skill: 1 - v.mae_log / p.mae_log, n: v.n };
    }) : [];
  const sCols: Column<SRow>[] = [
    { key: "Model", label: "Model", value: (d) => d.Model, render: (d) => <span className="inline-flex items-center gap-2"><span aria-hidden className="inline-block h-0.5 w-4" style={{ background: COLOR[d.m] }} />{d.Model}</span> },
    { key: "mae", label: "MAE (log)", value: (d) => d.mae, render: (d) => d.mae.toFixed(3), numeric: true },
    { key: "rmse", label: "RMSE (log)", value: (d) => d.rmse, render: (d) => d.rmse.toFixed(3), numeric: true },
    { key: "wape", label: "WAPE (USD)", value: (d) => d.wape, render: (d) => pct(d.wape), numeric: true },
    { key: "bias", label: "Bias (log)", value: (d) => d.bias, render: (d) => d.bias.toFixed(3), numeric: true },
    { key: "skill", label: "Skill vs persistence", value: (d) => d.skill, render: (d) => signed(d.skill), numeric: true },
    { key: "n", label: "Links (n)", value: (d) => d.n, render: (d) => d.n.toLocaleString("en-US"), numeric: true },
  ];
  const bySize = fm
    ? Object.entries(fm.breakdown.holdout.by_size)
        .map(([k, v]) => { const [size, m] = k.split("|"); return { size, m, model: LABEL[m], mae: v.mae_log, n: v.n }; })
        .filter((d) => shown.includes(d.m))
    : [];

  const series = seriesQ.data ?? [];
  const actual = d3.groups(series, (d) => d.target_year).map(([y, g]) => ({ year: y, v: g[0].actual_kusd }));
  const preds = series.filter((d) => shown.includes(d.model)).map((d) => ({ ...d, label: LABEL[d.model] }));
  const basketShort = (id: string) => info?.baskets.find((b) => b.id === id)?.short_label ?? id;
  const linkItems = links.map((l) => ({ value: linkKey(l), label: `${name(l.exporter_iso3)} to ${name(l.importer_iso3)}, ${basketShort(l.basket_id)}` }));

  const hp = holdout && fm ? fm.breakdown.holdout.pooled : null;
  const scopeToggle = (
    <div className="space-y-1.5">
      <Label>Models in charts</Label>
      <ToggleGroup value={[scope]} onValueChange={(v) => v[0] && setScope(v[0] as "key" | "all")} aria-label="Models shown in charts">
        <ToggleGroupItem value="key">Persistence, gravity, boosting</ToggleGroupItem>
        <ToggleGroupItem value="all">All {models.length || ""} models</ToggleGroupItem>
      </ToggleGroup>
    </div>
  );

  return (
    <Page
      wide
      title="Can next year's trade links be predicted better than “same as last year”?"
      lead="For each recorded supplier-to-importer link in a basket, predict its value next year using only data up to this year. Simple persistence is the baseline to beat; a gravity model and gradient-boosted trees are compared against it. Not beating persistence is a valid result."
      meta={
        <>
          <Badge variant="outline" className="border-dashed">Forecast: model output</Badge>
          <Badge variant="outline">CEPII BACI {info?.source.hs_revision} V{info?.source.release}</Badge>
          <Badge variant="outline">Retrospective backtest on revised data</Badge>
        </>
      }
      actions={scopeToggle}
    >
      {fm && holdout && hp && (
        <div className="grid gap-4 [&>*]:min-w-0 sm:grid-cols-3">
          {KEY.map((m) => (
            <Stat
              key={m}
              tone="forecast"
              accent={COLOR[m]}
              label={`${LABEL[m]}, ${holdout.target_year} holdout`}
              value={`${hp[m].mae_log.toFixed(3)} MAE`}
              context={m === "persistence" ? `WAPE ${pct(hp[m].wape_usd)}. The baseline: next year equals this year.` : `Skill ${signed(1 - hp[m].mae_log / hp.persistence.mae_log)} vs persistence; WAPE ${pct(hp[m].wape_usd)} (persistence ${pct(hp.persistence.wape_usd)})`}
            />
          ))}
        </div>
      )}
      {fm && holdout && (
        <p className="max-w-3xl text-sm text-muted-foreground">
          Target: {fm.target}. <span className="text-foreground">Error</span> is the mean absolute error of log value: 0.10 is roughly a 10% typical miss. <span className="text-foreground">Skill</span> is the error reduction against persistence: positive is better, negative is worse.
          WAPE weights misses by USD value, so it is dominated by the largest links. The {holdout.target_year} holdout was evaluated once, after every modelling choice was fixed. {fm.caveat} Real-time forecasts would face older, less complete data and a publication lag of about a year.
        </p>
      )}

      <Section title="Chronological folds" description="Each fold trains on years up to two before its target, builds features from the year before, and tests on the target year. No future data enters training.">
        <PlotFigure
          deps={[fm, info]}
          label="Chronological fold design: training, feature and target years for each fold."
          make={(width) => ({
            width, height: 60 + 26 * (fm?.folds.length ?? 0), marginLeft: 150,
            x: { label: null, tickFormat: "d", ticks: years.filter((y) => y % 2 === 0) },
            y: { label: null },
            color: { legend: true, domain: ["Training (features + targets)", "Features for test", "Validation target", "Holdout target", "Unused"], range: ["#2c4a63", "#3a86ff", "#a996f5", "#f2a96b", "#1a252b"] },
            marks: [
              Plot.cell(ribbon, { x: "year", y: "fold", fill: "kind", inset: 1, rx: 2 }),
              Plot.tip(ribbon, Plot.pointer({ x: "year", y: "fold", ...TIP, title: (d: (typeof ribbon)[number]) => `${d.fold}, ${d.year}: ${d.kind}` })),
            ],
          })}
        />
      </Section>

      <div className="grid gap-10 [&>*]:min-w-0 lg:grid-cols-2">
        <Section title="Error by fold (lower is better)" note="The dotted line separates the validation folds from the holdout year, whose points are filled. Model lines are dashed: they are forecast scores, not observed values.">
          <PlotFigure
            deps={[perFold, holdout]}
            label="Mean absolute error of log value by target year and model."
            make={(width) => ({
              width, height: 320, marginLeft: 50,
              x: { label: "Target year", tickFormat: "d" }, y: { label: "↑ MAE (log value)", grid: true, zero: true }, color,
              marks: [
                Plot.gridY({ strokeOpacity: 0.06 }),
                holdout ? Plot.ruleX([holdout.target_year - 0.5], { stroke: "#93a8ba", strokeOpacity: 0.4, strokeDasharray: "2,3" }) : null,
                Plot.lineY(perFold, { x: "target", y: "mae", stroke: "model", strokeWidth: 1.5, strokeDasharray: "5,3" }),
                Plot.dot(perFold, { x: "target", y: "mae", stroke: "model", fill: (d: (typeof perFold)[number]) => (d.role === "holdout" ? d.model : BG), r: 3.5 }),
                Plot.tip(perFold, Plot.pointer({ x: "target", y: "mae", ...TIP, title: (d: (typeof perFold)[number]) => `${d.model}\n${d.target}${d.role === "holdout" ? " (holdout)" : ""}: MAE ${d.mae.toFixed(3)}` })),
              ],
            })}
          />
        </Section>
        <Section title="Skill against persistence by fold" note="Zero is persistence itself. Below zero, the model did worse than “same as last year”.">
          <PlotFigure
            deps={[perFold]}
            label="Skill against persistence by target year and model."
            make={(width) => ({
              width, height: 320, marginLeft: 50,
              x: { label: "Target year", tickFormat: "d" }, y: { label: "↑ Skill (error reduction vs persistence)", tickFormat: "+%", grid: true }, color,
              marks: [
                Plot.gridY({ strokeOpacity: 0.06 }),
                Plot.ruleY([0], { stroke: "#93a8ba", strokeOpacity: 0.5 }),
                Plot.lineY(perFold, { x: "target", y: "skill", stroke: "model", strokeWidth: 1.5, strokeDasharray: "5,3" }),
                Plot.dot(perFold, { x: "target", y: "skill", stroke: "model", fill: BG, r: 3 }),
                Plot.tip(perFold, Plot.pointer({ x: "target", y: "skill", ...TIP, title: (d: (typeof perFold)[number]) => `${d.model}\n${d.target}: skill ${signed(d.skill)}` })),
              ],
            })}
          />
        </Section>
      </div>

      <div className="space-y-14">
        <Section title={val.length ? `Validation folds ${val[0].target_year}–${val.at(-1)!.target_year}, pooled` : "Validation folds, pooled"} description="All models, pooled over every validation fold. Click a column to sort.">
          <DataTable rows={summaryRows("validation")} columns={sCols} rowKey={(d) => d.m} initialSort={{ key: "mae" }} maxHeight="none" caption="Validation folds, pooled" />
        </Section>
        <Section
          title={`Holdout ${holdout?.target_year ?? ""}`}
          description="Evaluated once, after modelling choices were fixed."
          note={
            holdout && fm ? (
              <>
                † {fm.post_hoc_note} Their validation-fold scores are fair. A clean test needs {holdout.target_year + 1}, once a later BACI release finalises it. {pct(holdout.disappearance_rate)} of links recorded in {holdout.target_year - 1} were not recorded in {holdout.target_year}; they are outside this benchmark.
              </>
            ) : null
          }
        >
          <DataTable rows={summaryRows("holdout")} columns={sCols} rowKey={(d) => d.m} initialSort={{ key: "mae" }} maxHeight="none" caption="Holdout scores" />
        </Section>
      </div>

      <Section
        title={`Holdout error by link size (value in year t)`}
        description="Small links are much noisier. Most of the value sits in the largest links, where all models do best."
      >
        <PlotFigure
          deps={[bySize]}
          label="Holdout mean absolute error by link size and model."
          make={(width) => ({
            width, height: 300, marginLeft: 50,
            x: { axis: null, domain: shown.map((m) => LABEL[m]) }, y: { label: "↑ MAE (log value)", grid: true },
            fx: { label: null, domain: SIZES }, color,
            marks: [
              Plot.gridY({ strokeOpacity: 0.06 }),
              Plot.barY(bySize, { fx: "size", x: "model", y: "mae", fill: "model", fillOpacity: 0.85 }),
              Plot.ruleY([0], { strokeOpacity: 0.3 }),
              Plot.tip(bySize, Plot.pointerX({ fx: "size", x: "model", y: "mae", ...TIP, title: (d: (typeof bySize)[number]) => `${d.model}, ${d.size}\nMAE ${d.mae.toFixed(3)}, n ${d.n.toLocaleString("en-US")}` })),
            ],
          })}
        />
        <DataTable
          rows={SIZES.map((s) => ({ s, ...Object.fromEntries(bySize.filter((d) => d.size === s).map((d) => [d.m, d.mae])), n: bySize.find((d) => d.size === s)?.n }))}
          rowKey={(d) => d.s}
          maxHeight="none"
          caption="Holdout MAE by link size"
          columns={[
            { key: "s", label: "Link size", value: (d) => d.s, sortable: false },
            { key: "n", label: "Links (n)", value: (d) => d.n, render: (d) => d.n?.toLocaleString("en-US") ?? "–", numeric: true, sortable: false },
            ...shown.map((m) => ({ key: m, label: LABEL[m], value: (d: Record<string, unknown>) => d[m] as number, render: (d: Record<string, unknown>) => (d[m] as number | undefined)?.toFixed(3) ?? "–", numeric: true, sortable: false })),
          ]}
        />
      </Section>

      <Section
        title="Explore one link"
        description="The solid line is observed value. Dashed lines and hollow points are each model's forecast for that year, made with data from the year before. The list holds the 400 largest links in the benchmark."
        note="Retrospective backtest on revised BACI data. Values in current USD."
      >
        <div className="space-y-1.5">
          <Label>Link</Label>
          <Select items={linkItems} value={current} onValueChange={(v) => v && setPick(v as string)}>
            <SelectTrigger className="w-full max-w-md"><SelectValue /></SelectTrigger>
            <SelectPopup>{linkItems.map((it) => <SelectItem key={it.value} value={it.value}>{it.label}</SelectItem>)}</SelectPopup>
          </Select>
        </div>
        <PlotFigure
          deps={[series, scope]}
          label="Observed value and model forecasts for the selected link."
          make={(width) => ({
            width, height: 320, marginLeft: 72,
            x: { label: "Target year", tickFormat: "d" }, y: { label: "↑ Value, current USD", tickFormat: (d: number) => usd(d), grid: true },
            color: { domain: ["Observed", ...shown.map((m) => LABEL[m])], range: ["#e6edf3", ...shown.map((m) => COLOR[m])], legend: true },
            marks: [
              Plot.gridY({ strokeOpacity: 0.06 }),
              Plot.lineY(preds, { x: "target_year", y: "pred_kusd", stroke: "label", strokeWidth: 1.2, strokeDasharray: "4,3", strokeOpacity: 0.85 }),
              Plot.dot(preds, { x: "target_year", y: "pred_kusd", stroke: "label", fill: BG, r: 3 }),
              Plot.lineY(actual, { x: "year", y: "v", stroke: () => "Observed", strokeWidth: 2.5 }),
              Plot.dot(actual, { x: "year", y: "v", fill: () => "Observed", r: 3.5 }),
              Plot.tip([...actual.map((d) => ({ x: d.year, y: d.v, t: `Observed ${d.year}: ${usd(d.v)}` })), ...preds.map((d) => ({ x: d.target_year, y: d.pred_kusd, t: `${d.label} forecast for ${d.target_year}: ${usd(d.pred_kusd)}` }))],
                Plot.pointer({ x: "x", y: "y", ...TIP, title: "t" })),
            ],
          })}
        />
        <DataTable
          rows={actual.map((a) => ({ year: a.year, v: a.v, ...Object.fromEntries(series.filter((s) => s.target_year === a.year).map((s) => [s.model, s.pred_kusd])) }))}
          rowKey={(d) => String(d.year)}
          maxHeight="none"
          caption="Observed and forecast values for the selected link"
          columns={[
            { key: "year", label: "Target year", value: (d) => d.year, render: (d) => String(d.year), sortable: false },
            { key: "v", label: "Observed", value: (d) => d.v, render: (d) => usd(d.v), numeric: true, sortable: false },
            ...shown.map((m) => ({ key: m, label: LABEL[m], value: (d: Record<string, unknown>) => d[m] as number, render: (d: Record<string, unknown>) => usd(d[m] as number | undefined), numeric: true, sortable: false })),
          ]}
        />
      </Section>
    </Page>
  );
}
