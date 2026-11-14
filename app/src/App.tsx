import { HashRouter, Route, Routes } from "react-router-dom";
import { AppShell } from "@/components/app-shell";
import { MapPage } from "@/pages/map-page";
import { OverviewPage } from "@/pages/overview-page";
import { ProfilePage } from "@/pages/profile-page";
import { MoversPage } from "@/pages/movers-page";
import { EuMonthlyPage } from "@/pages/eu-monthly-page";
import { NetworkPage } from "@/pages/network-page";
import { ScenariosPage } from "@/pages/scenarios-page";
import { FindingsPage } from "@/pages/findings-page";
import { ForecastPage } from "@/pages/forecast-page";
import { MethodologyPage } from "@/pages/methodology-page";
import { SeaPage } from "@/pages/sea-page";

// Hash routing keeps the build a plain static site (no server rewrites needed on any host).
export default function App() {
  return (
    <HashRouter>
      <AppShell>
        <Routes>
          <Route path="/" element={<OverviewPage />} />
          <Route path="/profile" element={<ProfilePage />} />
          <Route path="/movers" element={<MoversPage />} />
          <Route path="/eu-monthly" element={<EuMonthlyPage />} />
          <Route path="/network" element={<NetworkPage />} />
          <Route path="/scenarios" element={<ScenariosPage />} />
          <Route path="/findings" element={<FindingsPage />} />
          <Route path="/forecast" element={<ForecastPage />} />
          <Route path="/methodology" element={<MethodologyPage />} />
          <Route path="/map" element={<MapPage />} />
          <Route path="/sea" element={<SeaPage />} />
          <Route path="*" element={<OverviewPage />} />
        </Routes>
      </AppShell>
    </HashRouter>
  );
}
