import { Button, Flex, Heading, Text } from "@chakra-ui/react";
import { useRouteError } from "react-router";

import { BrandMark } from "../components/icons";

/**
 * Router-level error boundary: a render crash anywhere in the app lands
 * here instead of react-router's default screen (or a blank page).
 */
export function RouteErrorPage() {
  const error = useRouteError();
  const message = error instanceof Error ? error.message : String(error);

  return (
    <Flex
      direction="column"
      alignItems="center"
      justifyContent="center"
      height="100vh"
      gap={3}
      color="fg.muted"
    >
      <BrandMark size={44} />
      <Heading size="md">Something went wrong</Heading>
      <Text
        fontSize="xs"
        fontFamily="mono"
        maxWidth="600px"
        whiteSpace="pre-wrap"
      >
        {message}
      </Text>
      <Flex gap={2}>
        <Button size="sm" onClick={() => window.location.reload()}>
          Reload
        </Button>
        <Button size="sm" variant="outline" asChild>
          {/* A plain anchor: the router state may be part of the crash. */}
          <a href="/">Back to dashboards</a>
        </Button>
      </Flex>
    </Flex>
  );
}
