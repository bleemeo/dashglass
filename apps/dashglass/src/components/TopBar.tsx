import { Fragment, type ReactNode } from "react";

import { Box, Flex, Link as ChakraLink } from "@chakra-ui/react";
import { Link } from "react-router";

export interface Crumb {
  label: string;
  to?: string;
  /** In-page navigation (e.g. exit a fullscreen panel) — used when there
   * is no distinct route to link to. */
  onClick?: () => void;
}

/**
 * Slim page header: a breadcrumb on the left (the last crumb is the page
 * title; earlier ones are links), page actions on the right. Used across
 * pages so the app has consistent chrome and a "where am I" trail.
 */
export function TopBar({
  crumbs,
  actions,
}: {
  crumbs: Crumb[];
  actions?: ReactNode;
}) {
  return (
    <Flex
      as="header"
      alignItems="center"
      justifyContent="space-between"
      gap={3}
      wrap="wrap"
      paddingBottom={3}
      borderBottomWidth="1px"
    >
      <Flex alignItems="center" gap={2} minWidth={0} fontSize="lg">
        {crumbs.map((crumb, index) => {
          const last = index === crumbs.length - 1;
          return (
            <Fragment key={index}>
              {index > 0 ? (
                <Box as="span" color="fg.subtle" fontWeight="normal">
                  /
                </Box>
              ) : null}
              {crumb.to && !last ? (
                <ChakraLink
                  asChild
                  color="fg.muted"
                  fontWeight="normal"
                  _hover={{ color: "fg", textDecoration: "none" }}
                >
                  <Link to={crumb.to}>{crumb.label}</Link>
                </ChakraLink>
              ) : crumb.onClick && !last ? (
                <ChakraLink
                  as="button"
                  color="fg.muted"
                  fontWeight="normal"
                  _hover={{ color: "fg", textDecoration: "none" }}
                  onClick={crumb.onClick}
                >
                  {crumb.label}
                </ChakraLink>
              ) : (
                <Box
                  as="span"
                  color="fg"
                  fontWeight="semibold"
                  truncate={last}
                >
                  {crumb.label}
                </Box>
              )}
            </Fragment>
          );
        })}
      </Flex>
      {actions ? (
        <Flex alignItems="center" gap={2} wrap="wrap" flexShrink={0}>
          {actions}
        </Flex>
      ) : null}
    </Flex>
  );
}
