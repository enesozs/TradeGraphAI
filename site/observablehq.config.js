// Observable Framework configuration for the TradeGraph AI static site (ADR-004).
const NAV = [
  ["Overview", "./"],
  ["Explore", [["Dependency profile", "./profile.html"], ["Biggest movers", "./movers.html"], ["EU monthly", "./eu-monthly.html"]]],
  ["Map & network", [["Trade map", "./map.html"], ["Network", "./network.html"]]],
  ["Simulate", [["Scenario studio", "./scenarios.html"]]],
  ["Research", [["Findings", "./findings.html"], ["Forecast lab", "./forecast.html"], ["Methodology", "./methodology.html"]]]
];
const navHtml = NAV.map(([label, target]) =>
  typeof target === "string"
    ? `<a class="tg-nav-top" href="${target}">${label}</a>`
    : `<span class="tg-nav-group"><span class="tg-nav-label">${label}</span>${target.map(([l, h]) => `<a href="${h}">${l}</a>`).join("")}</span>`
).join("");

export default {
  title: "TradeGraph AI",
  root: "src",
  style: "style.css", // design system: Observable air / near-midnight themes + TradeGraph tokens
  pages: [
    {name: "Overview", path: "/"},
    {name: "Dependency profile", path: "/profile"},
    {name: "Biggest movers", path: "/movers"},
    {name: "EU monthly", path: "/eu-monthly"},
    {name: "Trade map", path: "/map"},
    {name: "Network", path: "/network"},
    {name: "Scenario studio", path: "/scenarios"},
    {name: "Findings", path: "/findings"},
    {name: "Forecast lab", path: "/forecast"},
    {name: "Methodology", path: "/methodology"}
  ],
  cleanUrls: false, // links end in .html, so the site works on any static host
  sidebar: false,
  header: `<nav class="tg-nav" aria-label="Main"><a class="tg-brand" href="./">TradeGraph <span>AI</span></a>${navHtml}</nav>`,
  toc: false,
  pager: false,
  search: false,
  footer:
    "Trade data: CEPII BACI (Gaulier &amp; Zignago, 2010) and CEPII Gravity, Etalab Open Licence 2.0 · Monthly EU data: Eurostat Comext DS-045409, © European Union, adapted · Borders: Natural Earth (public domain). TradeGraph AI is not affiliated with or endorsed by CEPII, Eurostat or any data provider. Lines on maps are statistical links, not shipping routes.",
  head: `<link rel="icon" href="data:,"><script>
/* Accessibility fixes for framework-generated markup (axe WCAG 2 AA audit, M5). */
(() => {
  document.documentElement.lang = "en";
  const vp = document.querySelector('meta[name="viewport"]');
  if (vp) vp.content = "width=device-width, initial-scale=1";
  const fix = (root) => {
    root.querySelectorAll("table input[type=checkbox]:not([aria-label]), table input[type=radio]:not([aria-label])").forEach((el) => {
      const tr = el.closest("tr");
      el.setAttribute("aria-label", tr && tr.parentElement.tagName === "THEAD" ? "Select all rows" : "Select row");
    });
    root.querySelectorAll("form input:not([aria-label]):not([id]), form input[type=range]:not([aria-label])").forEach((el) => {
      const label = el.closest("form")?.querySelector("label")?.textContent?.trim();
      if (label) el.setAttribute("aria-label", label);
    });
    root.querySelectorAll("svg g[aria-label]:not([role])").forEach((g) => g.setAttribute("role", "group"));
  };
  new MutationObserver(() => fix(document)).observe(document.documentElement, {childList: true, subtree: true});
  addEventListener("DOMContentLoaded", () => fix(document));
})();
</script>`
};
