import { useState } from "react";

import { CloseButton, Flex, Link as ChakraLink, Text } from "@chakra-ui/react";
import { Link } from "react-router";

import { usePermissions } from "../api/hooks";

const DISMISS_KEY = "dashglass-auth-banner-dismissed";

function readDismissed(): boolean {
  try {
    return window.localStorage.getItem(DISMISS_KEY) === "true";
  } catch {
    return false;
  }
}

/**
 * Open-access warning: until the first user exists, everyone reaching the
 * instance is an anonymous admin. The Admin page explains it, but nobody
 * lands there by accident — this keeps it visible everywhere (dismissible
 * per browser, for deliberate open installs).
 */
export function AuthDisabledBanner() {
  const { loading, authEnabled } = usePermissions();
  const [dismissed, setDismissed] = useState(readDismissed);

  if (loading || authEnabled || dismissed) {
    return null;
  }

  const dismiss = () => {
    setDismissed(true);
    try {
      window.localStorage.setItem(DISMISS_KEY, "true");
    } catch {
      // Not persisting is fine.
    }
  };

  return (
    <Flex
      alignItems="center"
      gap={2}
      paddingX={4}
      paddingY={1.5}
      backgroundColor="orange.subtle"
      borderBottomWidth="1px"
      borderColor="orange.400"
    >
      <Text fontSize="sm" flex={1}>
        <Text as="span" fontWeight="medium">
          Authentication is disabled
        </Text>{" "}
        — anyone reaching this instance can view and administer it.{" "}
        <ChakraLink asChild textDecoration="underline">
          <Link to="/admin">Create an admin user</Link>
        </ChakraLink>
      </Text>
      <CloseButton size="2xs" aria-label="Dismiss" onClick={dismiss} />
    </Flex>
  );
}
