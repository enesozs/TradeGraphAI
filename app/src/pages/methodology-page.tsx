import type { ReactNode } from "react";
import { Page, Section } from "@/components/page";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useJson } from "@/lib/db";
import type { BuildInfo } from "@/lib/meta";

type Info = Omit<BuildInfo, "baskets"> & {
  built_at: string;
  basket_config_sha256: string;
  baskets: (BuildInfo["baskets"][number] & { rationale?: string })[];
};

function List({ children }: { children: ReactNode }) {
  return <ul className="max-w-3xl list-disc space-y-2.5 pl-5 text-sm text-muted-foreground marker:text-border [&_strong]:text-foreground [&_em]:text-foreground">{children}</ul>;
}
function Prose({ children }: { children: ReactNode }) {
  return <div className="max-w-3xl space-y-3 text-sm text-muted-foreground [&_strong]:text-foreground">{children}</div>;
}
const Code = ({ children }: { children: ReactNode }) => <code className="rounded bg-muted px-1 py-0.5 text-xs text-foreground">{children}</code>;

export function MethodologyPage() {
  const info = useJson<Info>("build_info.json");
  const src = info?.source;

  return (
    <Page
      title="Methodology"
      lead="Where the data comes from, how each measure is computed, and what the results can and cannot tell you."
      meta={src && <>
        <Badge variant="outline">CEPII BACI {src.hs_revision} V{src.release}</Badge>
        <Badge variant="outline">{info.years[0]}–{info.years.at(-1)}</Badge>
      </>}
    >
      <Section title="Data">
        <Prose>
          <p>
            <strong>Source:</strong> CEPII BACI, revision {src?.hs_revision ?? "–"}, release V{src?.release ?? "–"}, covering years {info ? `${info.years[0]}–${info.years.at(-1)}` : "–"}.
            The latest year ({info?.provisional_years.join(", ") ?? "–"}) is provisional and may be revised.
          </p>
          <p>BACI reconciles the two reports of each trade flow, the exporter's and the importer's, into a single figure:</p>
        </Prose>
        <List>
          <li>It estimates shipping and insurance costs and removes them from import values.</li>
          <li>It weights each reporting country by how reliable its reports are.</li>
        </List>
        <Prose>
          <p>Values are in thousands of current US dollars and quantities in metric tonnes. Only strictly positive flows are recorded, so <strong>a missing flow means "not recorded", not "zero"</strong>.</p>
          <p><em>{src?.citation}</em> Licence: {src?.license ?? "–"}. This site is not affiliated with or endorsed by CEPII.</p>
        </Prose>
      </Section>

      <Section
        title="Product baskets"
        description={<>A basket is a set of 6-digit {src?.hs_revision ?? "HS"} product codes, defined in <Code>configs/baskets.yaml</Code>. Codes are kept as strings.</>}
        note={info && <>Basket config SHA-256 <span className="font-mono">{info.basket_config_sha256.slice(0, 12)}…</span>. "Value only" baskets have no meaningful tonnes basis.</>}
      >
        <Table>
          <TableHeader>
            <TableRow><TableHead>Basket</TableHead><TableHead>HS codes</TableHead><TableHead>Value only</TableHead><TableHead>Rationale and caveats</TableHead></TableRow>
          </TableHeader>
          <TableBody>
            {(info?.baskets ?? []).map((b) => (
              <TableRow key={b.id} className="align-top">
                <TableCell className="whitespace-normal font-medium text-foreground">{b.label}</TableCell>
                <TableCell className="whitespace-normal font-mono text-xs">{b.codes.join(", ")}</TableCell>
                <TableCell>{b.value_only ? "Yes" : ""}</TableCell>
                <TableCell className="min-w-72 whitespace-normal text-muted-foreground">
                  <p>{b.rationale?.trim()}</p>
                  {b.caveats?.length ? <ul className="mt-1.5 list-disc space-y-1 pl-4 text-xs">{b.caveats.map((c) => <li key={c}>{c}</li>)}</ul> : null}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Section>

      <Section title="Metrics" description={<>For importer <em>i</em>, basket <em>p</em> and year <em>t</em>, with supplier <em>e</em>'s exports to <em>i</em> written v(e→i):</>}>
        <List>
          <li><strong>Supplier share:</strong> v(e→i) ÷ Σ v(e′→i), summed over <strong>all</strong> suppliers e′.</li>
          <li><strong>HHI:</strong> the sum of squared shares. It runs from near 0 (many small suppliers) to 1 (a single supplier). <strong>Effective suppliers</strong> = 1 ÷ HHI.</li>
          <li><strong>Tonnes basis:</strong> the same formulas using quantities, computed only over flows that have a recorded quantity. Coverage is reported alongside, and it's switched off for baskets where tonnes aren't meaningful (chips).</li>
          <li><strong>Redirectable supply:</strong> supplier e's basket exports to every country other than <em>i</em>. It's an observed upper bound on what e could send <em>i</em> instead, ignoring contracts, product mix, logistics and policy. It is <strong>not</strong> a forecast.</li>
        </List>
      </Section>

      <Section title="Network and gravity baseline">
        <List>
          <li><strong>Network:</strong> one directed graph per basket and year. Arrows run from exporter to importer, weighted by recorded value.</li>
          <li><strong>Supplier centrality:</strong> PageRank on the reversed graph, so importers pass importance to their suppliers in proportion to import shares. It describes position in the network; it doesn't measure indispensability.</li>
          <li><strong>Gravity model:</strong> a PPML regression of each pair's trade on distance, shared border, common official language, colonial tie and trade agreement in force, with exporter-year and importer-year effects. Inputs come from CEPII Gravity V202211; agreements after 2021 carry the 2021 status forward. <strong>Inside this model only</strong>, pairs with no recorded trade count as zero, which PPML requires.</li>
          <li><strong>Relative to gravity:</strong> centrality on the observed network divided by centrality on the gravity-expected network. Gravity reproduces each country's total trade exactly, so this ratio isolates <em>who trades with whom</em>.</li>
          <li><strong>Robustness:</strong> dropping the smallest 10% of economies leaves the results essentially unchanged.</li>
        </List>
      </Section>

      <Section title="What this does not show">
        <List>
          <li>Aggregate trade flows are not firm-level supply chains or shipping routes.</li>
          <li>Concentration measures exposure; it doesn't measure risk or likelihood of disruption.</li>
          <li>Values are nominal, so price swings move them. Compare the value and tonnes views.</li>
          <li>Hub re-exports can overstate a hub's role and hide the country of origin.</li>
        </List>
      </Section>

      {info && (
        <p className="text-xs text-muted-foreground">
          Data built {new Date(info.built_at).toLocaleString("en-GB", { dateStyle: "long", timeStyle: "short", timeZone: "UTC" })} UTC.
        </p>
      )}
    </Page>
  );
}
