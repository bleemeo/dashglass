import { useEffect, useState, type ReactNode } from "react";

import {
  Box,
  Button,
  Field,
  Flex,
  Heading,
  IconButton,
  Input,
  InputGroup,
  Text,
} from "@chakra-ui/react";
import { useQueryClient } from "@tanstack/react-query";
import { useNavigate, useSearchParams } from "react-router";

import { ColorModeButton } from "@dashglass/ui";

import { APIError, login } from "../api/client";
import { useCapabilities, usePermissions } from "../api/hooks";
import { BrandMark } from "../components/icons";
import { usePageTitle } from "../hooks/usePageTitle";

// Fixed brand surface (intentionally the same in light and dark).
const BRAND_GRADIENT = "linear-gradient(150deg, #2a78d6 0%, #1c4f97 55%, #14356b 100%)";

/**
 * Decorative monitoring motif for the brand panel: a stylized dashboard
 * (an area chart with gridlines, a secondary series, a live dot, and two
 * stat tiles), drawn in translucent white over the gradient.
 */
function MonitoringArt() {
  return (
    <svg
      viewBox="0 0 360 220"
      width="100%"
      role="img"
      aria-label="Dashboard illustration"
      style={{ maxWidth: 420, color: "white" }}
    >
      <defs>
        <linearGradient id="dashglass-area" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="white" stopOpacity="0.28" />
          <stop offset="100%" stopColor="white" stopOpacity="0" />
        </linearGradient>
      </defs>

      {/* Two stat tiles. */}
      {[0, 1].map((i) => (
        <g key={i} transform={`translate(${i * 176}, 0)`}>
          <rect width="164" height="52" rx="8" fill="white" fillOpacity="0.08" />
          <rect x="14" y="14" width="46" height="6" rx="3" fill="white" fillOpacity="0.35" />
          <rect x="14" y="28" width="80" height="12" rx="4" fill="white" fillOpacity="0.75" />
          <path
            d={i === 0 ? "M112 34 L124 28 L136 32 L148 20" : "M112 24 L124 30 L136 22 L148 30"}
            fill="none"
            stroke="white"
            strokeOpacity="0.55"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </g>
      ))}

      {/* Chart card. */}
      <g transform="translate(0, 68)">
        <rect width="360" height="152" rx="10" fill="white" fillOpacity="0.06" />
        {/* Gridlines. */}
        {[36, 72, 108].map((y) => (
          <line
            key={y}
            x1="16"
            y1={y}
            x2="344"
            y2={y}
            stroke="white"
            strokeOpacity="0.12"
            strokeDasharray="3 5"
          />
        ))}
        {/* Area under the primary series. */}
        <path
          d="M16 118 L60 96 L104 104 L148 70 L192 82 L236 50 L280 62 L324 34 L344 40 L344 136 L16 136 Z"
          fill="url(#dashglass-area)"
        />
        {/* Secondary series. */}
        <path
          d="M16 124 L60 118 L104 122 L148 110 L192 114 L236 104 L280 110 L324 96 L344 100"
          fill="none"
          stroke="white"
          strokeOpacity="0.4"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        {/* Primary series. */}
        <path
          d="M16 118 L60 96 L104 104 L148 70 L192 82 L236 50 L280 62 L324 34 L344 40"
          fill="none"
          stroke="white"
          strokeOpacity="0.92"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        {/* Live dot. */}
        <circle cx="344" cy="40" r="9" fill="white" fillOpacity="0.25" />
        <circle cx="344" cy="40" r="4" fill="white" />
      </g>
    </svg>
  );
}

function EyeIcon({ off }: { off: boolean }) {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="1.8" />
      {off ? (
        <path d="M4 4l16 16" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      ) : null}
    </svg>
  );
}

/** A callout box (expired session / OIDC callback error). */
function Callout({ tone, children }: { tone: "info" | "error"; children: ReactNode }) {
  const error = tone === "error";
  return (
    <Box
      fontSize="sm"
      paddingX={3}
      paddingY={2}
      borderRadius="md"
      borderWidth="1px"
      borderColor={error ? "border.error" : "border"}
      backgroundColor={error ? "bg.error" : "bg.muted"}
      color={error ? "fg.error" : "fg.muted"}
    >
      {children}
    </Box>
  );
}

export function LoginPage() {
  usePageTitle("Sign in");
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { proxy, authenticated } = usePermissions();
  const capabilities = useCapabilities();
  const oidc = capabilities.data?.auth?.kind === "oidc";
  const [searchParams] = useSearchParams();
  const callbackError = searchParams.get("error");
  const expired = searchParams.get("reason") === "expired";
  // Where to land after signing in: same-origin path only (a "//" or
  // absolute URL in ?next= must not become an open redirect).
  const rawNext = searchParams.get("next") ?? "/";
  const next =
    rawNext.startsWith("/") && !rawNext.startsWith("//") ? rawNext : "/";
  // Once identified, leave the login page. In proxy mode the identity
  // comes from headers, so an authenticated proxy user is redirected;
  // an unauthenticated one gets a note (below) instead of a bounce loop.
  useEffect(() => {
    if (authenticated) {
      void navigate(next, { replace: true });
    }
  }, [authenticated, navigate, next]);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const submit = async () => {
    setPending(true);
    setError(null);
    try {
      await login(username, password);
      await queryClient.invalidateQueries();
      void navigate(next);
    } catch (loginError) {
      setError(
        loginError instanceof APIError ? loginError.message : String(loginError),
      );
    } finally {
      setPending(false);
    }
  };

  let form: ReactNode;
  if (oidc) {
    form = (
      <Flex direction="column" gap={4}>
        <Text fontSize="sm" color="fg.muted">
          This instance uses single sign-on.
        </Text>
        {callbackError ? <Callout tone="error">{callbackError}</Callout> : null}
        <Button
          asChild
          size="md"
          width="full"
          colorPalette="brand"
        >
          <a href="/api/auth/oidc/login">Sign in with SSO</a>
        </Button>
      </Flex>
    );
  } else if (proxy) {
    form = (
      <Flex direction="column" gap={3}>
        <Text fontSize="sm" fontWeight="medium">
          Authentication is handled by a reverse proxy
        </Text>
        <Text fontSize="sm" color="fg.muted">
          You reached Dashglass without an identity from the proxy. Access it
          through your authenticating proxy, or check that it forwards the
          identity headers.
        </Text>
      </Flex>
    );
  } else {
    form = (
      <Flex
        as="form"
        direction="column"
        gap={4}
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <Field.Root>
          <Field.Label>Username</Field.Label>
          <Input
            size="md"
            autoFocus
            autoComplete="username"
            value={username}
            onChange={(event) => setUsername(event.target.value)}
          />
        </Field.Root>
        <Field.Root>
          <Field.Label>Password</Field.Label>
          <InputGroup
            endElement={
              <IconButton
                size="xs"
                variant="ghost"
                color="fg.muted"
                aria-label={showPassword ? "Hide password" : "Show password"}
                title={showPassword ? "Hide password" : "Show password"}
                onClick={() => setShowPassword((shown) => !shown)}
              >
                <EyeIcon off={showPassword} />
              </IconButton>
            }
          >
            <Input
              size="md"
              type={showPassword ? "text" : "password"}
              autoComplete="current-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          </InputGroup>
        </Field.Root>
        {error ? <Callout tone="error">{error}</Callout> : null}
        <Button
          type="submit"
          size="md"
          width="full"
          marginTop={1}
          colorPalette="brand"
          loading={pending}
          disabled={username === "" || password === ""}
        >
          Sign in
        </Button>
      </Flex>
    );
  }

  return (
    <Flex minHeight="100vh" alignItems="stretch">
      {/* Brand panel — decorative, wide screens only. */}
      <Flex
        display={{ base: "none", lg: "flex" }}
        flex="1"
        direction="column"
        justifyContent="space-between"
        padding={12}
        color="white"
        style={{ background: BRAND_GRADIENT }}
      >
        <Heading
          size="lg"
          fontWeight="bold"
          display="flex"
          alignItems="center"
          gap={2}
        >
          <BrandMark size={24} tone="onBrand" />
          Dashglass
        </Heading>
        <Box>
          <Heading size="2xl" lineHeight="1.15" maxWidth="16ch">
            Your metrics, at a glance.
          </Heading>
          <Box marginTop={10}>
            <MonitoringArt />
          </Box>
        </Box>
        <Text fontSize="xs" opacity={0.7}>
          {capabilities.data?.version
            ? `Version ${capabilities.data.version}`
            : ""}
        </Text>
      </Flex>

      {/* Form panel. */}
      <Flex
        flex="1"
        alignItems="center"
        justifyContent="center"
        padding={{ base: 6, md: 10 }}
        position="relative"
      >
        <Box position="absolute" top={4} right={4}>
          <ColorModeButton />
        </Box>
        <Flex direction="column" gap={6} width="full" maxWidth="360px">
          {/* Compact brand header for narrow screens. */}
          <Heading
            size="lg"
            display={{ base: "flex", lg: "none" }}
            justifyContent="center"
            alignItems="center"
            gap={2}
          >
            <BrandMark size={22} />
            Dashglass
          </Heading>
          <Box>
            <Heading size="lg">Sign in</Heading>
            <Text fontSize="sm" color="fg.muted" marginTop={1}>
              {proxy
                ? "Identity comes from your reverse proxy."
                : oidc
                  ? "Continue with your identity provider."
                  : "Enter your credentials to continue."}
            </Text>
          </Box>
          {expired ? (
            <Callout tone="info">
              Your session expired — sign in to continue where you left off.
            </Callout>
          ) : null}
          {form}
        </Flex>
      </Flex>
    </Flex>
  );
}
