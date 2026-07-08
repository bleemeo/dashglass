import { lazy } from "react";

import {
  HTTPPrometheusDataSource,
  registerPrometheusVariableSources,
} from "@dashglass/datasource-prometheus";
import { registerBuiltinPanels } from "@dashglass/panels-builtin";
import { createRegistries } from "@dashglass/runtime";

import { DashboardsIcon, ExploreIcon } from "./components/icons";

// Every route page is code-split so the entry (and the /login first paint)
// stays lean: the dashboard model's YAML/TOML parsers, react-grid-layout
// and the panel forms only load once a page that needs them is visited.
// A single Suspense boundary in App covers all of these.
const DashboardsPage = lazy(() =>
  import("./pages/DashboardsPage").then((m) => ({ default: m.DashboardsPage })),
);
const ExplorePage = lazy(() =>
  import("./pages/ExplorePage").then((m) => ({ default: m.ExplorePage })),
);
const DashboardPage = lazy(() =>
  import("./pages/DashboardPage").then((m) => ({ default: m.DashboardPage })),
);
const EditDashboardPage = lazy(() =>
  import("./pages/EditDashboardPage").then((m) => ({
    default: m.EditDashboardPage,
  })),
);
const DashboardEditorPage = lazy(() =>
  import("./pages/DashboardEditorPage").then((module) => ({
    default: module.DashboardEditorPage,
  })),
);

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
    nav: { title: "Dashboards", icon: <DashboardsIcon />, order: 1 },
  });
  registries.pages.register({
    kind: "explore",
    path: "/explore",
    element: <ExplorePage />,
    nav: { title: "Explore", icon: <ExploreIcon />, order: 2 },
  });
  registries.pages.register({
    kind: "dashboard-view",
    path: "/d/:name",
    element: <DashboardPage />,
  });
  registries.pages.register({
    kind: "dashboard-edit",
    path: "/d/:name/edit",
    element: <DashboardEditorPage />,
  });
  registries.pages.register({
    kind: "dashboard-code",
    path: "/d/:name/code",
    element: <EditDashboardPage />,
  });

  // Same-origin: the Go backend (or the vite dev proxy) serves /api/v1/*.
  const datasource = new HTTPPrometheusDataSource({ baseURL: "" });

  return { registries, datasource };
}
