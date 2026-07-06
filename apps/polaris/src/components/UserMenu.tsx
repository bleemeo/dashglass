import { useState } from "react";

import { Badge, Button, Flex, Text } from "@chakra-ui/react";
import { useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router";

import { logout } from "../api/client";
import { usePermissions } from "../api/hooks";
import { ChangePasswordDialog } from "./ChangePasswordDialog";

/** Signed-in identity + sign-out, above the color-mode row in the sidebar. */
export function UserMenu({ collapsed }: { collapsed: boolean }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  // Passwords are local-store only: proxy/OIDC identities manage theirs
  // at the provider.
  const { username, role, authKind } = usePermissions();
  const [changingPassword, setChangingPassword] = useState(false);

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
      {authKind === "builtin" ? (
        <Button
          size="xs"
          variant="ghost"
          justifyContent="flex-start"
          color="fg.muted"
          onClick={() => setChangingPassword(true)}
        >
          Change password
        </Button>
      ) : null}
      <Button
        size="xs"
        variant="ghost"
        justifyContent="flex-start"
        color="fg.muted"
        onClick={() => void signOut()}
      >
        Sign out
      </Button>
      {changingPassword ? (
        <ChangePasswordDialog onClose={() => setChangingPassword(false)} />
      ) : null}
    </Flex>
  );
}
