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

import { ColorModeButton } from "@polarisui/ui";

import { APIError, login } from "../api/client";
import { useCapabilities, usePermissions } from "../api/hooks";
import { usePageTitle } from "../hooks/usePageTitle";

// Fixed brand surface (intentionally the same in light and dark).
const BRAND_GRADIENT = "linear-gradient(150deg, #2a78d6 0%, #1c4f97 55%, #14356b 100%)";

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
          bg="brand.600"
          color="white"
          _hover={{ bg: "brand.500" }}
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
          You reached Polaris without an identity from the proxy. Access it
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
          bg="brand.600"
          color="white"
          _hover={{ bg: "brand.500" }}
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
        <Heading size="lg" fontWeight="bold">
          ✦ Polaris
        </Heading>
        <Box>
          <Heading size="2xl" lineHeight="1.15" maxWidth="18ch">
            Prometheus-native dashboards, versioned in git.
          </Heading>
          <Text marginTop={4} fontSize="md" opacity={0.85} maxWidth="34ch">
            The dashboard part of Grafana — nothing else. Edit in the UI,
            review in git, deploy anywhere.
          </Text>
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
            display={{ base: "block", lg: "none" }}
            textAlign="center"
          >
            ✦ Polaris
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
