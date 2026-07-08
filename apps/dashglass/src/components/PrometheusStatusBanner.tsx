import { Flex, Link as ChakraLink, Text } from "@chakra-ui/react";
import { Link } from "react-router";

import { usePermissions, usePrometheusHealth } from "../api/hooks";

/**
 * App-wide banner when the data source is missing or unreachable — the
 * direct answer to the new user's "why is everything showing no data?".
 * Clears itself once Prometheus answers again (the query is polled).
 */
export function PrometheusStatusBanner() {
  const health = usePrometheusHealth();
  const { isAdmin } = usePermissions();
  if (!health.data || (health.data.configured && health.data.reachable)) {
    return null;
  }

  const error = health.data.configured; // configured but unreachable
  const headline = error
    ? "Prometheus unreachable"
    : "No Prometheus configured";
  const detail = error
    ? `${health.data.error ?? "the server did not respond"}. Check that it is running and the URL is correct.`
    : "dashboards will show no data.";

  return (
    <Flex
      alignItems="center"
      gap={2}
      paddingX={4}
      paddingY={1.5}
      backgroundColor={error ? "bg.error" : "orange.subtle"}
      borderBottomWidth="1px"
      borderColor={error ? "border.error" : "orange.400"}
    >
      <Text fontSize="sm" color={error ? "fg.error" : "fg"}>
        <Text as="span" fontWeight="medium">
          {headline}
        </Text>{" "}
        — {detail}{" "}
        {isAdmin ? (
          <ChakraLink asChild textDecoration="underline" color="inherit">
            <Link to="/admin">Configure it in Admin → Datasource.</Link>
          </ChakraLink>
        ) : null}
      </Text>
    </Flex>
  );
}
