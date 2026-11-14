"""Render the M0 basket coverage report (reports/m0/coverage_2023.html) from coverage_2023.json.

Exploratory M0 script (superseded by the M1 pipeline). Usage, from the repo root:
    python scripts/m0/render_coverage.py reports/m0/coverage_2023.json reports/m0/coverage_2023.html
"""
import json
import sys

src, out = sys.argv[1], sys.argv[2]
data = json.load(open(src))

TEMPLATE = r"""<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Basket Coverage 2023</title>
<style>
:root{--bg:#f7f8fa;--surface:#fff;--ink:#14181f;--muted:#5b6574;--line:#dfe3ea;--obs:#0f7c8a;--obs-soft:#cfe9ec;--warn:#b5523b;--chip:#eef1f5;
--b1:#2f8f6b;--b2:#c08a1e;--b3:#b5523b}
@media (prefers-color-scheme:dark){:root:not([data-theme="light"]){--bg:#0f1318;--surface:#161b22;--ink:#e7ebf0;--muted:#97a1ae;--line:#2a313b;--obs:#3fb8c6;--obs-soft:#1d3a40;--warn:#e08a72;--chip:#1f252e;--b1:#4cb98f;--b2:#d9a441;--b3:#e08a72}}
:root[data-theme="dark"]{--bg:#0f1318;--surface:#161b22;--ink:#e7ebf0;--muted:#97a1ae;--line:#2a313b;--obs:#3fb8c6;--obs-soft:#1d3a40;--warn:#e08a72;--chip:#1f252e;--b1:#4cb98f;--b2:#d9a441;--b3:#e08a72}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif}
main{max-width:1180px;margin:0 auto;padding:28px 16px 60px}
h1{font-size:26px;margin:0 0 4px;letter-spacing:-.01em}
.sub{color:var(--muted);margin:0 0 14px}
.chips{display:flex;flex-wrap:wrap;gap:6px;margin-bottom:18px}
.chip{background:var(--chip);border:1px solid var(--line);border-radius:999px;padding:2px 10px;font-size:12.5px;color:var(--muted)}
.chip.obs{color:var(--obs);border-color:var(--obs)}
.note{border-left:3px solid var(--warn);background:var(--surface);padding:10px 14px;margin:0 0 22px;color:var(--muted);font-size:14px}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(min(340px,100%),1fr));gap:16px}
.card{background:var(--surface);border:1px solid var(--line);border-radius:12px;padding:16px;min-width:0}
.tw{overflow-x:auto}
.card h2{font-size:16.5px;margin:0}
.meta{color:var(--muted);font-size:12.5px;margin:2px 0 12px}
.kpis{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-bottom:14px}
.kpi{background:var(--chip);border-radius:8px;padding:6px 8px}
.kpi b{display:block;font-size:17px;font-variant-numeric:tabular-nums}
.kpi span{font-size:11.5px;color:var(--muted)}
h3{font-size:12px;text-transform:uppercase;letter-spacing:.06em;color:var(--muted);margin:12px 0 6px;font-weight:600}
.bar{display:grid;grid-template-columns:118px 1fr 52px;align-items:center;gap:8px;font-size:13px;margin:3px 0}
.bar .lab{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.bar .track{height:12px;background:var(--obs-soft);border-radius:3px;overflow:hidden}
.bar .fill{height:100%;background:var(--obs)}
.bar .val{text-align:right;font-variant-numeric:tabular-nums;color:var(--muted)}
.stack{display:flex;height:16px;border-radius:4px;overflow:hidden;margin:4px 0}
.stack div{height:100%}
.legend{display:flex;flex-wrap:wrap;gap:10px;font-size:12px;color:var(--muted)}
.legend i{display:inline-block;width:10px;height:10px;border-radius:2px;margin-right:4px;vertical-align:-1px}
table{width:100%;border-collapse:collapse;font-size:13px;font-variant-numeric:tabular-nums}
th,td{text-align:right;padding:4px 6px;border-bottom:1px solid var(--line)}
th:first-child,td:first-child{text-align:left}
th{color:var(--muted);font-weight:600;font-size:12px}
footer{margin-top:28px;color:var(--muted);font-size:13px}
.s19{color:var(--warn)}
</style>
</head>
<body>
<main>
<h1>Product-basket coverage, 2023</h1>
<p class="sub">M0 feasibility check: what one year of reconciled bilateral trade data shows for the draft baskets.</p>
<div class="chips">
  <span class="chip obs">OBSERVED</span>
  <span class="chip">CEPII BACI · HS12 · V202601</span>
  <span class="chip">Values: current USD (FOB-reconciled)</span>
  <span class="chip">Denominator: all partner countries</span>
  <span class="chip">Year 2023</span>
</div>
<p class="note"><strong>How to read this.</strong> These are exploratory M0 aggregates, not findings. Shares and HHI use each importer's total imports from <em>all</em> partners. Absent flows are "not recorded", not zero. <span class="s19">S19</span> is BACI's "Other Asia, nes", which in practice is Taiwan. Re-exports through hubs (e.g. HKG, SGP, NLD) can inflate a supplier's apparent role.</p>
<div class="grid" id="grid"></div>
<footer id="foot"></footer>
</main>
<script>
const DATA = __DATA__;
const fmt = kusd => { const usd = kusd*1e3; return usd>=1e12 ? "$"+(usd/1e12).toFixed(1)+" tn" : usd>=1e9 ? "$"+(usd/1e9).toFixed(usd>=1e10?0:1)+" bn" : "$"+(usd/1e6).toFixed(0)+" m"; };
const pct = x => (100*x).toFixed(1)+"%";
const BK = [["diversified (<0.15)","var(--b1)","Diversified HHI < 0.15"],["moderate (0.15–0.25)","var(--b2)","Moderate 0.15–0.25"],["concentrated (≥0.25)","var(--b3)","Concentrated ≥ 0.25"]];
const order = ["ics","liion","lichem","ree","abx","coffee"];
const grid = document.getElementById("grid");
const esc = s => String(s).replace(/[&<>"]/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));
const cc = c => c === "S19" ? '<span class="s19" title="Other Asia, nes (Taiwan)">S19</span>' : esc(c);
for (const id of order) {
  const b = DATA.baskets.find(x => x.id === id); if (!b) continue;
  const top = b.top_exporters, max = top[0].kusd;
  const bars = top.map(e => `<div class="bar"><span class="lab" title="${esc(e.name)}">${cc(e.iso3)} · ${esc(e.name)}</span><span class="track" role="img" aria-label="${esc(e.name)} ${pct(e.kusd/b.world_kusd)} of world exports"><span class="fill" style="display:block;width:${(100*e.kusd/max).toFixed(1)}%"></span></span><span class="val">${pct(e.kusd/b.world_kusd)}</span></div>`).join("");
  const totVal = b.hhi_buckets.reduce((s,x)=>s+x.kusd,0);
  const seg = BK.map(([k,col]) => { const x = b.hhi_buckets.find(y=>y.bucket===k); return x ? `<div style="width:${(100*x.kusd/totVal).toFixed(2)}%;background:${col}" title="${k}: ${x.importers} importers, ${pct(x.kusd/totVal)} of import value"></div>` : ""; }).join("");
  const leg = BK.map(([k,col,lab]) => { const x = b.hhi_buckets.find(y=>y.bucket===k); return `<span><i style="background:${col}"></i>${lab}: ${x?x.importers:0} importers · ${x?pct(x.kusd/totVal):"0%"} of value</span>`; }).join("");
  const rows = b.focal.map(f => `<tr><td>${esc(f.iso3)}</td><td>${fmt(f.kusd)}</td><td>${f.suppliers}</td><td>${f.hhi.toFixed(2)}</td><td>${cc(f.top1_iso3)} ${pct(f.top1)}</td></tr>`).join("");
  grid.insertAdjacentHTML("beforeend", `<section class="card"><h2>${esc(b.label)}</h2>
  <div class="meta">${b.rows.toLocaleString()} flow rows · quantity missing on ${pct(b.q_missing_share)} of rows</div>
  <div class="kpis"><div class="kpi"><b>${fmt(b.world_kusd)}</b><span>world trade</span></div><div class="kpi"><b>${b.exporters}</b><span>exporters</span></div><div class="kpi"><b>${b.importers}</b><span>importers</span></div></div>
  <h3>Top exporters · share of world exports</h3>${bars}
  <h3>Importer concentration · share of import value</h3><div class="stack" role="img" aria-label="Import value by importer concentration class">${seg}</div><div class="legend">${leg}</div>
  <h3>Selected importers</h3><div class="tw"><table><thead><tr><th>Importer</th><th>Imports</th><th>Suppliers</th><th>HHI</th><th>Top supplier</th></tr></thead><tbody>${rows}</tbody></table></div></section>`);
}
document.getElementById("foot").innerHTML = `World merchandise trade in this file: ${fmt(DATA.world_total_kusd)}. Source: CEPII BACI (Gaulier &amp; Zignago 2010), Etalab 2.0 licence. Basket codes: configs/baskets.yaml. Generated by scripts/m0/render_coverage.py.`;
</script>
</body>
</html>
"""

open(out, "w").write(TEMPLATE.replace("__DATA__", json.dumps(data)))
print("wrote", out)
