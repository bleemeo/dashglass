import {
  HTTPPrometheusDataSource,
  registerPrometheusVariableSources,
} from "@polarisui/datasource-prometheus";
import { registerBuiltinPanels } from "@polarisui/panels-builtin";
import { createRegistries } from "@polarisui/runtime";

import { DashboardPage } from "./pages/DashboardPage";
import { DashboardsPage } from "./pages/DashboardsPage";
import { EditDashboardPage } from "./pages/EditDashboardPage";
import { ExplorePage } from "./pages/ExplorePage";

/**
 * The assembly point of the open-core model: this app registers the
 * built-in plugin set; the SaaS panel assembles the same engine with its
 * proprietary plugins added.
 */
export function createAppSetup() {
  const registries = createRegistries();
  registerBuiltinPanels(registries.panels);
  registerPrometheusVariableSources(registries.variableSources);

  registries.pages.register({
    kind: "dashboards",
    path: "/",
    element: <DashboardsPage />,
    nav: { title: "Dashboards", order: 1 },
  });
  registries.pages.register({
    kind: "explore",
    path: "/explore",
    element: <ExplorePage />,
    nav: { title: "Explore", order: 2 },
  });
  registries.pages.register({
    kind: "dashboard-view",
    path: "/d/:name",
    element: <DashboardPage />,
  });
  registries.pages.register({
    kind: "dashboard-edit",
    path: "/d/:name/edit",
    element: <EditDashboardPage />,
  });

  // Same-origin: the Go backend (or the vite dev proxy) serves /api/v1/*.
  const datasource = new HTTPPrometheusDataSource({ baseURL: "" });

  return { registries, datasource };
}
