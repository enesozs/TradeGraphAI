import { ChevronLeftIcon, ChartNetworkIcon, SlidersHorizontalIcon, FlaskConicalIcon, GlobeIcon, LayoutDashboardIcon, LineChartIcon, ScrollTextIcon, SearchIcon, ShipIcon, TrendingUpIcon, WavesIcon, ZapIcon } from "lucide-react";
import type { ReactNode } from "react";
import { NavLink, useLocation } from "react-router-dom";
import { SidebarPanelProvider, useSidebarPanelState } from "@/components/sidebar-panel";
import { Button } from "@/components/ui/button";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarTrigger,
} from "@/components/ui/sidebar";

type Item = { to: string; label: string; icon: ReactNode };
const NAV: { label: string; items: Item[] }[] = [
  { label: "Explore", items: [
    { to: "/", label: "Overview", icon: <LayoutDashboardIcon /> },
    { to: "/profile", label: "Dependency profile", icon: <SearchIcon /> },
    { to: "/movers", label: "Biggest movers", icon: <TrendingUpIcon /> },
    { to: "/eu-monthly", label: "EU monthly", icon: <LineChartIcon /> },
  ] },
  { label: "See the flows", items: [
    { to: "/map", label: "Trade map", icon: <GlobeIcon /> },
    { to: "/sea", label: "Sea routes", icon: <ShipIcon /> },
    { to: "/network", label: "Network", icon: <ChartNetworkIcon /> },
  ] },
  { label: "Simulate", items: [{ to: "/scenarios", label: "Scenario studio", icon: <ZapIcon /> }] },
  { label: "Research", items: [
    { to: "/findings", label: "Findings", icon: <ScrollTextIcon /> },
    { to: "/forecast", label: "Forecast lab", icon: <FlaskConicalIcon /> },
    { to: "/methodology", label: "Methodology", icon: <WavesIcon /> },
  ] },
];

export function AppShell({ children }: { children: ReactNode }) {
  return (
    <SidebarPanelProvider>
      <Shell>{children}</Shell>
    </SidebarPanelProvider>
  );
}

function Shell({ children }: { children: ReactNode }) {
  const { pathname } = useLocation();
  const { title, setSlot, showNav, setShowNav } = useSidebarPanelState();
  const showPanel = title != null && !showNav;
  return (
    <SidebarProvider>
      <Sidebar collapsible="icon">
        <SidebarHeader>
          <NavLink to="/" className="flex items-center gap-2 px-2 py-1.5 text-[15px] font-semibold text-foreground">
            <span aria-hidden className="inline-block size-2.5 rounded-full bg-[var(--tg-observed)] shadow-[0_0_12px_var(--tg-observed)]" />
            <span className="group-data-[collapsible=icon]:hidden">TradeGraph</span>
          </NavLink>
        </SidebarHeader>
        <SidebarContent>
          {showPanel ? (
            <div className="flex flex-col gap-4 px-3 pb-4 group-data-[collapsible=icon]:hidden">
              <Button variant="ghost" size="sm" className="self-start -ml-1.5 text-muted-foreground" onClick={() => setShowNav(true)}>
                <ChevronLeftIcon aria-hidden /> Menu
              </Button>
              <h2 className="text-[15px] font-semibold text-foreground">{title}</h2>
              <div ref={setSlot} />
            </div>
          ) : (
          <>
          {title != null && (
            <div className="px-3 pt-1 group-data-[collapsible=icon]:hidden">
              <Button variant="outline" size="sm" className="w-full justify-start" onClick={() => setShowNav(false)}>
                <SlidersHorizontalIcon aria-hidden /> Back to {title.toLowerCase()} settings
              </Button>
            </div>
          )}
          {NAV.map((g) => (
            <SidebarGroup key={g.label}>
              <SidebarGroupLabel>{g.label}</SidebarGroupLabel>
              <SidebarGroupContent>
                <SidebarMenu>
                  {g.items.map((it) => (
                    <SidebarMenuItem key={it.to}>
                      <SidebarMenuButton isActive={pathname === it.to} tooltip={it.label} render={<NavLink to={it.to} />}>
                        {it.icon}
                        <span>{it.label}</span>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  ))}
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>
          ))}
          </>
          )}
        </SidebarContent>
        <SidebarFooter>
          <p className="px-2 text-xs leading-snug text-muted-foreground group-data-[collapsible=icon]:hidden">
            Data: CEPII BACI, CEPII Gravity, Eurostat Comext, IMF PortWatch.
          </p>
        </SidebarFooter>
      </Sidebar>
      <SidebarInset className="min-h-svh min-w-0">
        <SidebarTrigger className="fixed top-3 left-3 z-30 md:hidden" />
        {children}
      </SidebarInset>
    </SidebarProvider>
  );
}
