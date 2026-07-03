import { useState } from "react";

import {
  Box,
  Flex,
  Heading,
  IconButton,
  Link as ChakraLink,
  Text,
} from "@chakra-ui/react";
import { Route, Routes, Link, useLocation } from "react-router";

import { useRuntime } from "@polarisui/runtime";
import { ColorModeButton } from "@polarisui/ui";

import { useCapabilities, useDashboardEvents } from "./api/hooks";
import { SidebarIcon } from "./components/icons";

const SIDEBAR_KEY = "polaris-sidebar-collapsed";

function readCollapsed(): boolean {
  try {
    return window.localStorage.getItem(SIDEBAR_KEY) === "true";
  } catch {
    return false;
  }
}

function SideBar({
  collapsed,
  onToggle,
}: {
  collapsed: boolean;
  onToggle: () => void;
}) {
  const { registries } = useRuntime();
  const location = useLocation();
  const capabilities = useCapabilities();

  const toggle = (
    <IconButton
      size="xs"
      variant="ghost"
      color="fg.muted"
      aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
      title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
      onClick={onToggle}
    >
      <SidebarIcon />
    </IconButton>
  );

  return (
    <Flex
      as="nav"
      direction="column"
      width={collapsed ? "52px" : "200px"}
      transition="width 0.15s ease"
      flexShrink={0}
      borderRightWidth="1px"
      paddingY={4}
      paddingX={collapsed ? 1.5 : 4}
      gap={1}
    >
      <Flex
        alignItems="center"
        justifyContent={collapsed ? "center" : "space-between"}
        marginBottom={4}
        minHeight="24px"
      >
        {collapsed ? (
          toggle
        ) : (
          <>
            <Heading size="md" whiteSpace="nowrap">
              ✦ Polaris
            </Heading>
            {toggle}
          </>
        )}
      </Flex>
      {registries.pages.navPages().map((page) => {
        const active =
          page.path === "/"
            ? location.pathname === "/"
            : location.pathname.startsWith(page.path);
        return (
          <ChakraLink
            key={page.kind}
            asChild
            paddingX={collapsed ? 0 : 3}
            paddingY={2}
            gap={2}
            borderRadius="md"
            justifyContent={collapsed ? "center" : "flex-start"}
            fontWeight={active ? "semibold" : "normal"}
            backgroundColor={active ? "bg.muted" : "transparent"}
            _hover={{ backgroundColor: "bg.muted" }}
            title={collapsed ? page.nav?.title : undefined}
          >
            <Link to={page.path}>
              {page.nav?.icon}
              {collapsed ? null : page.nav?.title}
            </Link>
          </ChakraLink>
        );
      })}
      <Box flex={1} />
      <Flex
        alignItems="center"
        justifyContent={collapsed ? "center" : "space-between"}
        gap={2}
      >
        {collapsed ? null : (
          <Text fontSize="xs" color="fg.muted" whiteSpace="nowrap">
            {capabilities.data?.readonly ? "read-only · " : ""}
            {capabilities.data?.version ?? ""}
          </Text>
        )}
        <ColorModeButton />
      </Flex>
    </Flex>
  );
}

export function App() {
  const { registries } = useRuntime();
  const [collapsed, setCollapsed] = useState(readCollapsed);
  useDashboardEvents();

  const toggle = () => {
    setCollapsed((current) => {
      try {
        window.localStorage.setItem(SIDEBAR_KEY, String(!current));
      } catch {
        // Not persisting is fine.
      }
      return !current;
    });
  };

  return (
    <Flex height="100vh" alignItems="stretch">
      <SideBar collapsed={collapsed} onToggle={toggle} />
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
