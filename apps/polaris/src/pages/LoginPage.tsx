import { useEffect, useState } from "react";

import {
  Button,
  Field,
  Flex,
  Heading,
  Input,
  Text,
} from "@chakra-ui/react";
import { useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router";

import { useSearchParams } from "react-router";

import { APIError, login } from "../api/client";
import { useCapabilities, usePermissions } from "../api/hooks";
import { usePageTitle } from "../hooks/usePageTitle";

export function LoginPage() {
  usePageTitle("Sign in");
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { proxy, authenticated } = usePermissions();
  const capabilities = useCapabilities();
  const oidc = capabilities.data?.auth?.kind === "oidc";
  const [searchParams] = useSearchParams();
  const callbackError = searchParams.get("error");
  // Once identified, leave the login page. In proxy mode the identity
  // comes from headers, so an authenticated proxy user is redirected;
  // an unauthenticated one gets a note (below) instead of a bounce loop.
  useEffect(() => {
    if (authenticated) {
      void navigate("/", { replace: true });
    }
  }, [authenticated, navigate]);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const submit = async () => {
    setPending(true);
    setError(null);
    try {
      await login(username, password);
      await queryClient.invalidateQueries();
      void navigate("/");
    } catch (loginError) {
      setError(
        loginError instanceof APIError ? loginError.message : String(loginError),
      );
    } finally {
      setPending(false);
    }
  };

  return (
    <Flex
      height="100%"
      alignItems="center"
      justifyContent="center"
      direction="column"
      gap={6}
    >
      <Heading size="xl">✦ Polaris</Heading>
      {oidc ? (
        <Flex
          direction="column"
          gap={3}
          width="320px"
          padding={6}
          borderWidth="1px"
          borderRadius="md"
          backgroundColor="bg.panel"
          alignItems="stretch"
        >
          {callbackError ? (
            <Text fontSize="sm" color="fg.error">
              {callbackError}
            </Text>
          ) : null}
          <Button asChild size="sm">
            <a href="/api/auth/oidc/login">Sign in with SSO</a>
          </Button>
        </Flex>
      ) : proxy ? (
        <Flex
          direction="column"
          gap={2}
          width="360px"
          padding={6}
          borderWidth="1px"
          borderRadius="md"
          backgroundColor="bg.panel"
        >
          <Text fontSize="sm" fontWeight="medium">
            Authentication is handled by a reverse proxy
          </Text>
          <Text fontSize="sm" color="fg.muted">
            You reached Polaris without an identity from the proxy. Access
            it through your authenticating proxy, or check that it forwards
            the identity headers.
          </Text>
        </Flex>
      ) : (
      <Flex
        as="form"
        direction="column"
        gap={4}
        width="320px"
        padding={6}
        borderWidth="1px"
        borderRadius="md"
        backgroundColor="bg.panel"
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <Field.Root>
          <Field.Label>Username</Field.Label>
          <Input
            size="sm"
            autoFocus
            autoComplete="username"
            value={username}
            onChange={(event) => setUsername(event.target.value)}
          />
        </Field.Root>
        <Field.Root>
          <Field.Label>Password</Field.Label>
          <Input
            size="sm"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
        </Field.Root>
        {error ? (
          <Text fontSize="sm" color="fg.error">
            {error}
          </Text>
        ) : null}
        <Button
          type="submit"
          size="sm"
          loading={pending}
          disabled={username === "" || password === ""}
        >
          Sign in
        </Button>
      </Flex>
      )}
    </Flex>
  );
}
