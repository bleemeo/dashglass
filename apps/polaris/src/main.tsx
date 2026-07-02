import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter } from "react-router";

import { RuntimeProvider } from "@polarisui/runtime";

import { App } from "./App";
import { createAppSetup } from "./setup";

const { registries, datasource } = createAppSetup();
const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, staleTime: 5_000 } },
});

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ChakraProvider value={defaultSystem}>
      <QueryClientProvider client={queryClient}>
        <RuntimeProvider datasource={datasource} registries={registries}>
          <BrowserRouter>
            <App />
          </BrowserRouter>
        </RuntimeProvider>
      </QueryClientProvider>
    </ChakraProvider>
  </StrictMode>,
);
