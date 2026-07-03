import { useState } from "react";

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

import { APIError, login } from "../api/client";
import { usePageTitle } from "../hooks/usePageTitle";

export function LoginPage() {
  usePageTitle("Sign in");
  const navigate = useNavigate();
  const queryClient = useQueryClient();
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
    </Flex>
  );
}
