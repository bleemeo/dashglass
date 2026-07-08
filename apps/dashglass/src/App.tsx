import { Suspense, lazy, useState } from "react";

import {
  Box,
  Flex,
  Heading,
  IconButton,
  Link as ChakraLink,
  Text,
} from "@chakra-ui/react";
import { Route, Routes, Link, useLocation, useSearchParams } from "react-router";

import { useRuntime } from "@dashglass/runtime";
import { ColorModeButton } from "@dashglass/ui";

import {
  useCapabilities,
  useDashboardEvents,
  usePermissions,
} from "./api/hooks";
import { AuthDisabledBanner } from "./components/AuthDisabledBanner";
import { PrometheusStatusBanner } from "./components/PrometheusStatusBanner";
import { ShortcutsHelp } from "./components/ShortcutsHelp";
import { AdminIcon, BrandMark, SidebarIcon } from "./components/icons";
import { UserMenu } from "./components/UserMenu";
import { LoginPage } from "./pages/LoginPage";
import { usePageTitle } from "./hooks/usePageTitle";

// Admin is a rarely-visited, admin-only route: keep it out of the entry.
const AdminPage = lazy(() =>
  import("./pages/AdminPage").then((m) => ({ default: m.AdminPage })),
);

const SIDEBAR_KEY = "dashglass-sidebar-collapsed";

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
  const { isAdmin, authEnabled } = usePermissions();

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
        direction={collapsed ? "column" : "row"}
        justifyContent={collapsed ? "center" : "space-between"}
        gap={collapsed ? 1 : 0}
        marginBottom={4}
        minHeight="24px"
      >
        {collapsed ? (
          <>
            {toggle}
            <ColorModeButton />
          </>
        ) : (
          <>
            <Heading
              size="md"
              whiteSpace="nowrap"
              display="flex"
              alignItems="center"
              gap={2}
            >
              <BrandMark size={20} />
              Dashglass
            </Heading>
            <Flex alignItems="center" gap={0.5}>
              <ColorModeButton />
              {toggle}
            </Flex>
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
            color={active ? "brand.fg" : undefined}
            backgroundColor={active ? "brand.subtle" : "transparent"}
            _hover={{ backgroundColor: active ? "brand.subtle" : "bg.muted" }}
            title={collapsed ? page.nav?.title : undefined}
          >
            <Link to={page.path}>
              {page.nav?.icon}
              {collapsed ? null : page.nav?.title}
            </Link>
          </ChakraLink>
        );
      })}
      {isAdmin ? (
        <ChakraLink
          asChild
          paddingX={collapsed ? 0 : 3}
          paddingY={2}
          gap={2}
          borderRadius="md"
          justifyContent={collapsed ? "center" : "flex-start"}
          fontWeight={location.pathname.startsWith("/admin") ? "semibold" : "normal"}
          color={location.pathname.startsWith("/admin") ? "brand.fg" : undefined}
          backgroundColor={
            location.pathname.startsWith("/admin") ? "brand.subtle" : "transparent"
          }
          _hover={{
            backgroundColor: location.pathname.startsWith("/admin")
              ? "brand.subtle"
              : "bg.muted",
          }}
          title={collapsed ? "Admin" : undefined}
        >
          <Link to="/admin">
            <AdminIcon />
            {collapsed ? null : "Admin"}
          </Link>
        </ChakraLink>
      ) : null}
      <Box flex={1} />
      {authEnabled ? <UserMenu collapsed={collapsed} /> : null}
      {collapsed ? null : (
        <Text fontSize="xs" color="fg.muted" whiteSpace="nowrap">
          {capabilities.data?.readonly ? "read-only · " : ""}
          {capabilities.data?.version ?? ""}
        </Text>
      )}
    </Flex>
  );
}

function NotFoundPage() {
  usePageTitle("Not found");
  return (
    <Flex
      direction="column"
      alignItems="center"
      justifyContent="center"
      height="100%"
      gap={3}
      color="fg.muted"
    >
      <BrandMark size={44} />
      <Heading size="md">Page not found</Heading>
      <Text fontSize="sm">This page doesn't exist (anymore).</Text>
      <ChakraLink asChild color="blue.600" _dark={{ color: "blue.400" }}>
        <Link to="/">Back to dashboards</Link>
      </ChakraLink>
    </Flex>
  );
}

export function App() {
  const { registries } = useRuntime();
  const [collapsed, setCollapsed] = useState(readCollapsed);
  const [searchParams] = useSearchParams();
  const { isAdmin } = usePermissions();
  // Kiosk mode (?kiosk): chrome-less rendering for wall screens.
  const kiosk = searchParams.has("kiosk");
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

  // The login page owns the full viewport (no sidebar).
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route
        path="*"
        element={
          <Flex direction="column" height="100vh">
            {kiosk ? null : <AuthDisabledBanner />}
            {kiosk ? null : <PrometheusStatusBanner />}
            <Flex flex={1} alignItems="stretch" minHeight={0}>
              {kiosk ? null : (
                <SideBar collapsed={collapsed} onToggle={toggle} />
              )}
              <Box flex={1} overflow="auto" padding={kiosk ? 4 : 6}>
                {/* One boundary for every code-split route page. */}
                <Suspense fallback={null}>
                  <Routes>
                    {registries.pages.list().map((page) => (
                      <Route
                        key={page.kind}
                        path={page.path}
                        element={page.element}
                      />
                    ))}
                    {isAdmin ? (
                      <Route path="/admin" element={<AdminPage />} />
                    ) : null}
                    <Route path="*" element={<NotFoundPage />} />
                  </Routes>
                </Suspense>
              </Box>
            </Flex>
            {kiosk ? null : <ShortcutsHelp />}
          </Flex>
        }
      />
    </Routes>
  );
}
