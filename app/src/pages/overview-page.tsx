import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { Swatch } from "@/components/page";
import { Badge } from "@/components/ui/badge";
import { useJson, useQuery } from "@/lib/db";
import { useCountryColors } from "@/lib/country-colors";
import { countryName, pct, usd } from "@/lib/format";
import { useGeo } from "@/lib/geo";
import { latestFinalYear, type BuildInfo } from "@/lib/meta";

type ComextInfo = { first_month: string; latest_month: string; latest_month_by_reporter?: Record<string, string> };
type ForecastMetrics = {
  folds: { target_year: number; role: string }[];
  breakdown: { holdout: { pooled: Record<string, { wape_usd: number; mae_log: number }> } };
};
type Info = BuildInfo & { movers: { start_years: [number, number]; end_years: [number, number] } };
type EuLi = { month: string; top1_iso3_12m: string | null; top1_share_12m: number | null; hhi_12m: number | null };
type Ree = { importer_iso3: string; start_share: number; end_share: number };
type Scen = { year: number; exposed_kusd: number; unmet_kusd: number; mc_unmet_p5: number; mc_unmet_p95: number };
type World = { flows: number; value_kusd: number; exporters: number; importers: number };

const monthLong = (iso?: string) => (iso ? new Date(`${iso.slice(0, 10)}T00:00:00Z`).toLocaleDateString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" }) : "–");
// Latest month, noting when some importers stop earlier (Eurostat has only partly published the newest month for them).
const latestText = (cx?: ComextInfo | null) => {
  const ends = Object.values(cx?.latest_month_by_reporter ?? {}).sort();
  return ends.length && ends[0] !== ends.at(-1) ? `${monthShort(ends.at(-1))} (${monthShort(ends[0])} for some importers)` : monthShort(cx?.latest_month);
};
const monthShort = (iso?: string) => (iso ? new Date(`${iso.slice(0, 10)}T00:00:00Z`).toLocaleDateString("en-GB", { month: "short", year: "numeric", timeZone: "UTC" }) : "–");
const span = (y?: [number, number]) => (y ? `${y[0]}–${String(y[1]).slice(2)}` : "–");

function useColor() {
  const colors = useCountryColors();
  return (iso3: string | null | undefined) => {
    const c = iso3 ? colors?.get(iso3) : undefined;
    return c ? `rgb(${c[0]}, ${c[1]}, ${c[2]})` : "var(--tg-haze)";
  };
}

const linkCls = "text-foreground underline decoration-border underline-offset-4 transition-colors hover:decoration-foreground";

// One headline figure: a large number on the left, the sentence that gives it meaning on the right.
function Headline({ kind, figure, children, source, to, toLabel }: {
  kind: "Observed" | "Scenario" | "Forecast"; figure: ReactNode; children: ReactNode; source: ReactNode; to: string; toLabel: string;
}) {
  const scenario = kind === "Scenario";
  return (
    <li className="grid gap-x-10 gap-y-3 border-t py-8 md:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
      <div className="space-y-3">
        <Badge variant="outline" className={scenario ? "border-[var(--tg-scenario)] text-[var(--tg-scenario)]" : undefined}>{kind}</Badge>
        <p className={`figure text-4xl sm:text-5xl ${scenario ? "text-[var(--tg-scenario)]" : "text-foreground"}`}>{figure}</p>
      </div>
      <div className="space-y-3 md:pt-9">
        <p className="text-base text-foreground sm:text-lg">{children}</p>
        <p className="text-xs text-muted-foreground">{source}</p>
        <Link to={to} className={`${linkCls} text-sm`}>{toLabel}</Link>
      </div>
    </li>
  );
}

export function OverviewPage() {
  const info = useJson<Info>("build_info.json");
  const cx = useJson<ComextInfo>("comext_info.json");
  const fm = useJson<ForecastMetrics>("forecast_metrics.json");
  const geo = useGeo();
  const color = useColor();
  const year = info ? latestFinalYear(info) : null;
  const name = (iso3?: string | null) => countryName(iso3, iso3 ? geo?.names.get(iso3) : null);

  // Headline numbers, all computed from the marts (same SQL as the legacy overview).
  const euLi = useQuery<EuLi>(
    `SELECT strftime(month, '%Y-%m-%d') AS month, top1_iso3_12m, top1_share_12m, hhi_12m FROM comext_importer
     WHERE reporter = 'EU27_2020_EXTRA' AND basket_id = 'li_ion_batteries' ORDER BY month DESC LIMIT 1`,
  ).data?.[0];
  const ree = useQuery<Ree>(
    `SELECT importer_iso3, start_share, end_share FROM movers_supplier
     WHERE basket_id = 'rare_earths_and_magnets' AND supplier_iso3 = 'CHN' AND importer_iso3 IN ('DEU', 'USA') ORDER BY importer_iso3`,
  ).data ?? [];
  const scn = useQuery<Scen>(
    `SELECT year, exposed_kusd, unmet_kusd, mc_unmet_p5, mc_unmet_p95 FROM scenario_summary
     WHERE basket_id = 'rare_earths_and_magnets' AND supplier_iso3 = 'CHN' AND shortfall = 0.5 AND capacity = 'central'`,
  ).data?.[0];
  // Size of the integrated-circuit trade drawn on the map: every recorded exporter→importer flow, all partners.
  const world = useQuery<World>(
    `SELECT count(*) AS flows, sum(value_kusd) AS value_kusd, count(DISTINCT supplier_iso3) AS exporters, count(DISTINCT importer_iso3) AS importers
     FROM supplier_basket_year WHERE basket_id = 'integrated_circuits' AND year = ?`,
    [year ?? 0],
  ).data?.[0];

  const holdYear = fm?.folds.find((f) => f.role === "holdout")?.target_year;
  const hold = fm?.breakdown.holdout.pooled;

  const modules: { to: string; title: string; text: ReactNode; scenario?: boolean }[] = [
    { to: "/profile", title: "Dependency profile", text: <>Who supplies a country with a product and how concentrated that is, by value and by tonnes, {info ? `${info.years[0]}–${info.years.at(-1)}` : ""}, with a quick exposure scenario.</> },
    { to: "/movers", title: "Biggest movers", text: <>Where supplier concentration rose or fell most between {span(info?.movers.start_years)} and {span(info?.movers.end_years)}.</> },
    { to: "/eu-monthly", title: "EU monthly monitor", text: <>Month-by-month supplier shares for the EU and six member states, up to {latestText(cx)}.</> },
    { to: "/map", title: "Trade map", text: "Flows on a map or globe, supplier-share and concentration maps, and a quick disruption preview." },
    { to: "/sea", title: "Sea routes", text: "Modelled sea lanes for each trade flow, the load passing each chokepoint, and what a closure would reroute." },
    { to: "/network", title: "Network", text: "Trade communities and who sits at their centre, compared with what a gravity model predicts." },
    { to: "/scenarios", title: "Scenario studio", scenario: true, text: "Simulate a supplier shortfall: exposed, reallocated and unmet demand under stated capacity assumptions, with uncertainty ranges." },
    { to: "/forecast", title: "Forecast lab", text: `Can next year's trade links be predicted better than "same as last year"? Models compared on retrospective, chronological backtests.` },
  ];

  return (
    <main className="mx-auto w-full max-w-6xl px-4 pb-24 pt-12 sm:px-8 lg:pt-20">
      {/* Hero: a typographic statement, not a second map. */}
      <header className="max-w-4xl space-y-6">
        <p className="text-sm font-medium text-muted-foreground">TradeGraph AI</p>
        <h1 className="figure text-4xl leading-[1.05] text-foreground sm:text-6xl">
          How dependent is each country on a few suppliers, and who could step in if one falls short?
        </h1>
        <p className="max-w-2xl text-base text-muted-foreground sm:text-lg">
          An open, evidence-first explorer of trade dependency for critical goods, built on reconciled customs data. Every number below is computed from the published data, with its year, unit and source beside it.
        </p>
        <div className="flex flex-wrap items-baseline gap-x-6 gap-y-2 pt-2 text-sm">
          <Link to="/map" className="rounded-md bg-foreground px-4 py-2 font-medium text-background transition-opacity hover:opacity-90">Open the trade map</Link>
          <span className="text-muted-foreground">
            {world && year
              ? <>{usd(world.value_kusd)} of integrated circuits in {year}, across {world.flows.toLocaleString("en-US")} recorded flows from {world.exporters} exporters to {world.importers} importers.</>
              : "Loading the integrated-circuit flows…"}
          </span>
        </div>
      </header>

      <section aria-labelledby="headlines" className="mt-20">
        <h2 id="headlines" className="mb-2 text-lg font-semibold text-foreground">Headlines from the data</h2>
        <ol>
          <Headline
            kind="Observed"
            figure={pct(euLi?.top1_share_12m, 0)}
            to="/eu-monthly"
            toLabel="EU monthly monitor"
            source={<>Eurostat Comext DS-045409, import values in EUR, trailing 12 months. Denominator: all extra-EU partners. Supplier HHI {euLi?.hhi_12m?.toFixed(2) ?? "–"}.</>}
          >
            of the EU's lithium-ion battery imports from outside the EU came from{" "}
            <span className="ml-1 inline-flex items-center gap-1.5 whitespace-nowrap"><Swatch color={color(euLi?.top1_iso3_12m)} />{name(euLi?.top1_iso3_12m)}</span>{" "}
            in the 12 months to {monthLong(euLi?.month)}.
          </Headline>

          <Headline
            kind="Observed"
            figure={
              <span className="flex flex-col gap-2 text-3xl sm:text-4xl">
                {ree.length ? ree.map((d) => (
                  <span key={d.importer_iso3} className="flex items-center gap-3">
                    <Swatch color={color(d.importer_iso3)} className="size-3" />
                    <span>{pct(d.start_share, 0)} to {pct(d.end_share, 0)}</span>
                    <span className="text-sm font-normal text-muted-foreground" style={{ fontVariationSettings: "normal" }}>{d.importer_iso3}</span>
                  </span>
                )) : "–"}
              </span>
            }
            to="/findings"
            toLabel="Read the finding"
            source={<>CEPII BACI {info?.source.hs_revision} V{info?.source.release}, shares of import value, {span(info?.movers.start_years)} average against {span(info?.movers.end_years)} average. Denominator: imports from all partners.</>}
          >
            China's share of rare-earth and magnet imports into{" "}
            {ree.map((d, i) => (
              <span key={d.importer_iso3}>{i > 0 && " and "}<span className="ml-1 inline-flex items-center gap-1.5 whitespace-nowrap"><Swatch color={color(d.importer_iso3)} />{name(d.importer_iso3)}</span></span>
            ))}
            . The rise is driven by permanent magnets.
          </Headline>

          <Headline
            kind="Scenario"
            figure={<>{usd(scn?.unmet_kusd)} unmet</>}
            to="/scenarios"
            toLabel="Scenario studio"
            source={<>Exposure arithmetic on {scn?.year ?? "–"} BACI flows under the central capacity assumption. Not a forecast, and no price, welfare or substitution effects.</>}
          >
            if China delivered 50% less rare earths and magnets, out of {usd(scn?.exposed_kusd)} of exposed imports. Across the uncertainty runs the unmet amount ranges from {usd(scn?.mc_unmet_p5)} to {usd(scn?.mc_unmet_p95)} (5th to 95th percentile).
          </Headline>

          <Headline
            kind="Forecast"
            figure={pct(hold?.persistence?.wape_usd, 1)}
            to="/forecast"
            toLabel="Forecast lab"
            source={<>Retrospective backtest on revised BACI data, chronological folds. WAPE is value-weighted absolute error over all trade links in the {holdYear ?? "–"} holdout.</>}
          >
            value-weighted error for "same as last year" on the {holdYear ?? "–"} holdout, against {pct(hold?.gbm_graph?.wape_usd, 1)} for gradient boosting with network features. The simple baseline is still hard to beat where the money is.
          </Headline>
        </ol>
      </section>

      <section aria-labelledby="explore" className="mt-16">
        <h2 id="explore" className="mb-6 text-lg font-semibold text-foreground">Explore</h2>
        <ul className="grid gap-x-12 sm:grid-cols-2">
          {modules.map((m) => (
            <li key={m.to} className="border-t py-5">
              <Link to={m.to} className={`text-base font-medium ${m.scenario ? "text-[var(--tg-scenario)] hover:underline" : linkCls}`}>{m.title}</Link>
              <p className="mt-1.5 text-sm text-muted-foreground">{m.text}</p>
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="data" className="mt-16">
        <h2 id="data" className="mb-4 text-lg font-semibold text-foreground">Data</h2>
        <dl className="grid gap-x-12 gap-y-4 text-sm sm:grid-cols-[max-content_1fr]">
          <dt className="font-medium text-foreground">CEPII BACI</dt>
          <dd className="text-muted-foreground">
            {info ? <>{info.source.hs_revision} release V{info.source.release}, annual, {info.years[0]}–{info.years.at(-1)} ({info.provisional_years.join(", ")} provisional). Values in thousands of current USD, quantities in tonnes.</> : "–"}
          </dd>
          <dt className="font-medium text-foreground">Eurostat Comext</dt>
          <dd className="text-muted-foreground">DS-045409, monthly, {monthShort(cx?.first_month)} to {latestText(cx)}. Values in EUR as declared by EU importers.</dd>
          <dt className="font-medium text-foreground">CEPII Gravity</dt>
          <dd className="text-muted-foreground">V202211: distance, shared borders, language and trade agreements.</dd>
        </dl>
        <p className="mt-6 text-sm text-muted-foreground">
          A missing flow means not recorded, not zero. How the numbers are built is in the <Link to="/methodology" className={linkCls}>methodology</Link>.
        </p>
      </section>
    </main>
  );
}
