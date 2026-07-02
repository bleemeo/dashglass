import { Box, Flex, Heading, Link as ChakraLink, Text } from "@chakra-ui/react";
import { Route, Routes, Link, useLocation } from "react-router";

import { useRuntime } from "@polarisui/runtime";
import { ColorModeButton } from "@polarisui/ui";

import { useCapabilities, useDashboardEvents } from "./api/hooks";

function SideBar() {
  const { registries } = useRuntime();
  const location = useLocation();
  const capabilities = useCapabilities();

  return (
    <Flex
      as="nav"
      direction="column"
      width="200px"
      flexShrink={0}
      borderRightWidth="1px"
      padding={4}
      gap={1}
    >
      <Heading size="md" marginBottom={4}>
        ✦ Polaris
      </Heading>
      {registries.pages.navPages().map((page) => {
        const active =
          page.path === "/"
            ? location.pathname === "/"
            : location.pathname.startsWith(page.path);
        return (
          <ChakraLink
            key={page.kind}
            asChild
            paddingX={3}
            paddingY={2}
            borderRadius="md"
            fontWeight={active ? "semibold" : "normal"}
            backgroundColor={active ? "bg.muted" : "transparent"}
            _hover={{ backgroundColor: "bg.muted" }}
          >
            <Link to={page.path}>{page.nav?.title}</Link>
          </ChakraLink>
        );
      })}
      <Box flex={1} />
      <Flex alignItems="center" justifyContent="space-between" gap={2}>
        <Text fontSize="xs" color="fg.muted">
          {capabilities.data?.readonly ? "provisioned (read-only) · " : ""}
          {capabilities.data?.version ?? ""}
        </Text>
        <ColorModeButton />
      </Flex>
    </Flex>
  );
}

export function App() {
  const { registries } = useRuntime();
  useDashboardEvents();

  return (
    <Flex height="100vh" alignItems="stretch">
      <SideBar />
      <Box flex={1} overflow="auto" padding={6}>
        <Routes>
          {registries.pages.list().map((page) => (
            <Route key={page.kind} path={page.path} element={page.element} />
          ))}
          <Route path="*" element={<Text>Page not found.</Text>} />
        </Routes>
      </Box>
    </Flex>
  );
}
