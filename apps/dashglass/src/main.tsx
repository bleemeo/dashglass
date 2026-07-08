import { StrictMode, type ReactNode } from "react";
import { createRoot } from "react-dom/client";

import { ChakraProvider } from "@chakra-ui/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createBrowserRouter, RouterProvider } from "react-router";

import {
  ChartThemeProvider,
  darkChartTheme,
  lightChartTheme,
} from "@dashglass/panels-builtin";
import { RuntimeProvider } from "@dashglass/runtime";
import { ColorModeProvider, dashglassSystem, useColorMode } from "@dashglass/ui";

import { isClientError } from "./api/client";
import { App } from "./App";
import { Toaster } from "./components/toaster";
import { RouteErrorPage } from "./pages/RouteErrorPage";
import { createAppSetup } from "./setup";

const { registries, datasource } = createAppSetup();
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // 4xx responses are definitive — retrying a 404 only delayed the
      // "dashboard not found" page behind seconds of "Loading…".
      retry: (failureCount, error) =>
        !isClientError(error) && failureCount < 1,
      staleTime: 5_000,
    },
  },
});

// A data router (not <BrowserRouter>) so editors can block in-app
// navigation while they hold unsaved changes (useBlocker). The app keeps
// its own <Routes> tree; this single splat route just anchors the router.
const router = createBrowserRouter([
  { path: "*", element: <App />, errorElement: <RouteErrorPage /> },
]);

/** Feeds the resolved color mode to the chart token set. */
function ChartThemeBridge({ children }: { children: ReactNode }) {
  const { resolved } = useColorMode();
  return (
    <ChartThemeProvider
      value={resolved === "dark" ? darkChartTheme : lightChartTheme}
    >
      {children}
    </ChartThemeProvider>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ColorModeProvider>
      <ChakraProvider value={dashglassSystem}>
        <ChartThemeBridge>
          <QueryClientProvider client={queryClient}>
            <RuntimeProvider datasource={datasource} registries={registries}>
              <RouterProvider router={router} />
              <Toaster />
            </RuntimeProvider>
          </QueryClientProvider>
        </ChartThemeBridge>
      </ChakraProvider>
    </ColorModeProvider>
  </StrictMode>,
);
