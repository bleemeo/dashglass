import { Badge, Button, Flex, Text } from "@chakra-ui/react";
import { useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router";

import { logout } from "../api/client";
import { usePermissions } from "../api/hooks";

/** Signed-in identity + sign-out, above the color-mode row in the sidebar. */
export function UserMenu({ collapsed }: { collapsed: boolean }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { username, role } = usePermissions();

  const signOut = async () => {
    await logout();
    await queryClient.invalidateQueries();
    void navigate("/login");
  };

  if (collapsed) {
    return (
      <Flex justifyContent="center" marginBottom={2}>
        <Button
          size="xs"
          variant="ghost"
          aria-label={`Sign out ${username ?? ""}`}
          title={`${username ?? ""} (${role ?? ""}) — sign out`}
          onClick={() => void signOut()}
        >
          ⏻
        </Button>
      </Flex>
    );
  }

  return (
    <Flex
      direction="column"
      gap={1}
      marginBottom={2}
      paddingBottom={2}
      borderBottomWidth="1px"
    >
      <Flex alignItems="center" gap={2}>
        <Text fontSize="sm" fontWeight="medium" truncate>
          {username}
        </Text>
        {role ? (
          <Badge size="xs" variant="subtle">
            {role}
          </Badge>
        ) : null}
      </Flex>
      <Button
        size="xs"
        variant="ghost"
        justifyContent="flex-start"
        color="fg.muted"
        onClick={() => void signOut()}
      >
        Sign out
      </Button>
    </Flex>
  );
}
