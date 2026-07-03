import { StrictMode, type ReactNode } from "react";
import { createRoot } from "react-dom/client";

import { ChakraProvider } from "@chakra-ui/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter } from "react-router";

import {
  ChartThemeProvider,
  darkChartTheme,
  lightChartTheme,
} from "@polarisui/panels-builtin";
import { RuntimeProvider } from "@polarisui/runtime";
import { ColorModeProvider, polarisSystem, useColorMode } from "@polarisui/ui";

import { App } from "./App";
import { Toaster } from "./components/toaster";
import { createAppSetup } from "./setup";

const { registries, datasource } = createAppSetup();
const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, staleTime: 5_000 } },
});

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
      <ChakraProvider value={polarisSystem}>
        <ChartThemeBridge>
          <QueryClientProvider client={queryClient}>
            <RuntimeProvider datasource={datasource} registries={registries}>
              <BrowserRouter>
                <App />
              </BrowserRouter>
              <Toaster />
            </RuntimeProvider>
          </QueryClientProvider>
        </ChartThemeBridge>
      </ChakraProvider>
    </ColorModeProvider>
  </StrictMode>,
);
