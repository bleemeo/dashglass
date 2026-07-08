import { Flex, Heading, Link as ChakraLink, Text } from "@chakra-ui/react";
import { Link } from "react-router";

import { usePageTitle } from "../hooks/usePageTitle";
import { BrandMark } from "./icons";

/** Friendly not-found state for /d/:name routes (stale bookmark, deleted
 * or renamed dashboard) — mirrors the app's unknown-route page. */
export function DashboardNotFound({ name }: { name: string }) {
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
      <Heading size="md">Dashboard not found</Heading>
      <Text fontSize="sm">
        No dashboard named "{name}" exists — it may have been deleted or
        renamed.
      </Text>
      <ChakraLink asChild color="blue.600" _dark={{ color: "blue.400" }}>
        <Link to="/">Back to dashboards</Link>
      </ChakraLink>
    </Flex>
  );
}
